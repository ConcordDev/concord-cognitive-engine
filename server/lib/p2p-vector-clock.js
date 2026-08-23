/**
 * Vector clocks for multi-peer (3+) P2P sync.
 *
 * server/lib/p2p-dtu-signalling.js's existing design is strictly 1:1 — one
 * offerer, one answerer, one global `offers` Map keyed by a single offerId.
 * That has no way to express "did peer C's view of room membership happen
 * before, after, or concurrently with peer B's view" once a third peer
 * joins — wall-clock timestamps can't answer that honestly (clock skew,
 * no shared clock across peers), which is exactly the problem vector
 * clocks solve: a purely causal (happens-before) partial order, no trusted
 * clock required.
 *
 * Scope: DTUs themselves are content-addressed (id = hash of content, see
 * dtu-protocol.js#generateId) — two peers independently authoring the same
 * DTU content produce the same id, so there's no "which version wins"
 * conflict for DTU *content* to resolve. The real multi-peer conflict this
 * module targets is MUTABLE shared state peers must agree on despite no
 * central coordinator — concretely, room membership (who's in the room),
 * which is genuinely concurrent-editable (two peers can each see a
 * different join/leave history before they've synced).
 */

// ── Core vector clock ops ────────────────────────────────────────────────

/**
 * @param {string} peerId
 * @returns {object} a fresh clock with this peer at 0
 */
export function createClock(peerId) {
  return { [peerId]: 0 };
}

/**
 * Increment a peer's own counter (call before/when that peer produces a new
 * causal event). Never mutates the input.
 * @param {object} clock
 * @param {string} peerId
 * @returns {object} new clock
 */
export function tick(clock, peerId) {
  const next = { ...(clock || {}) };
  next[peerId] = (next[peerId] || 0) + 1;
  return next;
}

/**
 * Component-wise max merge — the standard vector-clock receive-side merge.
 * Never mutates either input.
 * @param {object} a
 * @param {object} b
 * @returns {object} merged clock
 */
export function merge(a, b) {
  const out = { ...(a || {}) };
  for (const [peerId, count] of Object.entries(b || {})) {
    out[peerId] = Math.max(out[peerId] || 0, count);
  }
  return out;
}

/**
 * Happens-before partial order between two clocks.
 * @param {object} a
 * @param {object} b
 * @returns {"before"|"after"|"equal"|"concurrent"}
 */
export function compare(a, b) {
  const clockA = a || {};
  const clockB = b || {};
  const keys = new Set([...Object.keys(clockA), ...Object.keys(clockB)]);
  let aLteB = true; // a[k] <= b[k] for every k
  let bLteA = true; // b[k] <= a[k] for every k
  for (const k of keys) {
    const av = clockA[k] || 0;
    const bv = clockB[k] || 0;
    if (av > bv) aLteB = false;
    if (bv > av) bLteA = false;
  }
  if (aLteB && bLteA) return "equal";
  if (aLteB) return "before"; // a happened-before b
  if (bLteA) return "after"; // a happened-after b
  return "concurrent"; // neither dominates — a real conflict
}

// ── Scalar conflict resolution (single mutable value, e.g. "current owner
// of a signalling slot") — deterministic tie-break with no trusted clock. ──

/**
 * Resolve two versions of the SAME scalar value written by (possibly)
 * different peers with (possibly) concurrent vector clocks.
 * - If one causally happened-after the other, it wins outright (this is
 *   real causality, not a guess).
 * - If concurrent, falls back to a deterministic-but-arbitrary tie-break
 *   (peerId lexical order, highest wins) so every peer independently
 *   reaches the SAME resolution without needing to exchange a decision —
 *   this is the standard Dynamo-style approach; it is honestly arbitrary
 *   (there's no principled way to prefer one truly-concurrent write over
 *   another without app-specific semantics) but it IS deterministic, which
 *   is what multi-peer convergence actually requires.
 * @param {{clock:object, peerId:string, value:*}} entryA
 * @param {{clock:object, peerId:string, value:*}} entryB
 * @returns {{winner:{clock:object,peerId:string,value:*}, relation:string}}
 */
export function resolveConcurrent(entryA, entryB) {
  const relation = compare(entryA.clock, entryB.clock);
  if (relation === "before") return { winner: entryB, relation };
  if (relation === "after") return { winner: entryA, relation };
  if (relation === "equal") return { winner: entryA, relation }; // idempotent — same causal point
  // concurrent: deterministic tie-break, same result on every peer
  const winner = entryA.peerId >= entryB.peerId ? entryA : entryB;
  return { winner, relation };
}

// ── Room-membership CRDT (add-wins observed-remove set) ──────────────────
// Membership is a SET peers mutate concurrently (join/leave), so a scalar
// last-writer-wins resolver would be wrong — losing a concurrent join
// because it "lost" a tie-break would silently drop a real peer from the
// room. An add-wins OR-Set is the standard correct CRDT shape for this:
// each add/remove is tagged with a unique (peerId, clock) event; a member
// is present iff it has at least one add-tag not dominated (causally
// superseded) by a later remove-tag from the same causal history.

/**
 * @typedef {{ peerId:string, clock:object, op:"join"|"leave" }} MembershipEvent
 */

/**
 * Fold a list of membership events (from any number of peers, any order —
 * merge is commutative/associative/idempotent, the CRDT convergence
 * properties) into the current member set.
 * @param {MembershipEvent[]} events
 * @returns {Set<string>} peerIds currently in the room
 */
export function resolveMembership(events) {
  // For each peerId, keep every event NOT causally dominated by a later
  // event for that same peerId. What's left is the "concurrent frontier";
  // the peer is present iff that frontier's most-recent-by-domination
  // events include at least one "join" with no "leave" that happened-after it.
  const byPeer = new Map();
  for (const ev of events || []) {
    if (!ev || !ev.peerId) continue;
    if (!byPeer.has(ev.peerId)) byPeer.set(ev.peerId, []);
    byPeer.get(ev.peerId).push(ev);
  }

  const present = new Set();
  for (const [peerId, evs] of byPeer.entries()) {
    // Reduce to the frontier: drop any event causally-before another event
    // in the same list (i.e. superseded). What survives is the set of
    // maximal (frontier) events — for a real single-actor event stream
    // these are almost always totally ordered by that actor's own clock
    // entry, but concurrent events from clock merges/replays are handled
    // via the "join beats leave at equal frontier rank" rule below.
    const frontier = evs.filter((ev) => !evs.some((other) => other !== ev && compare(ev.clock, other.clock) === "before"));
    // Add-wins: present if ANY frontier event is a join. This is the
    // defining choice of "add-wins" (vs. "remove-wins") OR-Set semantics —
    // a concurrent join+leave resolves to present, matching the intuition
    // that a peer who is actively (re)joining shouldn't be silently
    // evicted by a leave it never causally observed.
    if (frontier.some((ev) => ev.op === "join")) present.add(peerId);
  }
  return present;
}

export default { createClock, tick, merge, compare, resolveConcurrent, resolveMembership };
