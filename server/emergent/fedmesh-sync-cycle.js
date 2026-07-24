// server/emergent/fedmesh-sync-cycle.js
//
// Wire-the-unwired (Wave E grounding audit, precedent: Layer 12's
// server/emergent/lattice-orchestrator.js).
//
// server/domains/fedmesh.js + server/lib/federation-mesh.js (migration 348)
// are a real, tested, DB-backed federation-mesh substrate — a persistent
// peer registry (`fedmesh_peers`), a consent-gated incoming-DTU inbox
// (`fedmesh_inbox`), and a consented "6th brain" peer consult
// (`consultFederatedBrain`) — but nothing ever called any of it
// automatically. Every operation only ran when a human (or a test)
// explicitly invoked a `fedmesh.*` macro. Zero hits for "fedmesh" existed
// anywhere in server/emergent/*.js before this file.
//
// What "sync" concretely means here (there is no separate sync protocol to
// invent — this file only puts EXISTING functions on a clock):
//
//   The mesh is PUSH-then-DRAIN by design, not pull. A peer calls OUR
//   `fedmesh.receive` macro (federation-mesh.js#receiveDtu, fedmesh.js:30-33)
//   to enqueue a DTU envelope into `fedmesh_inbox` with
//   consent_status='pending'. Nothing ever evaluates that backlog against
//   our consent policy unless a human calls the `fedmesh.drain` macro by
//   hand (fedmesh.js:35-38) — so pending envelopes could sit unprocessed
//   forever. `drainInbox(db, policy)` (federation-mesh.js:76-94) IS the real
//   periodic maintenance action: it walks the pending queue, rejects
//   outright anything from a revoked peer (`reason: 'peer_revoked'`), and
//   evaluates the rest via the pure `evaluateConsent`. That row-level
//   `revoked.has(row.from_peer)` check is what already gives "one
//   revoked/bad peer never blocks draining another peer's items" — this
//   orchestrator does not add a new isolation mechanism, it puts the
//   existing one on a clock and this file's test suite proves it holds.
//
//   There is no "pull new messages FROM a peer" function anywhere in
//   federation-mesh.js (unlike cnet-federation.js's `pollGlobal`, already
//   wired at lattice-orchestrator.js#runFederationPoll for the OTHER,
//   in-memory federation substrate). `consultFederatedBrain` does make a
//   real per-peer HTTP call over connectorFetch, but it exists to answer a
//   live user's chat turn with real messages — firing it unconditionally on
//   a timer with no messages would mean POSTing manufactured content to
//   peers' brain endpoints every cadence, which is inventing new mesh
//   traffic. This unit deliberately does not do that. If a future unit adds
//   a real pull-sync protocol to federation-mesh.js, this orchestrator is
//   the right place to wire it in.
//
//   So the one genuine "sync with known peers" action this substrate
//   supports today is: drain the consent-gated inbox, and report current
//   peer-registry counts (known / active / revoked) for observability.
//
// Default drain policy mirrors the `fedmesh.drain` macro's own default
// (server/domains/fedmesh.js:37, `input.policy || {}`) — no declared intent
// to use derivatives or commercially, the conservative default under which
// most inbound is accepted unless the peer is revoked or the envelope's own
// consent explicitly disallows even a plain read.
//
// Both steps below (drain, peer-count) are independently try/catch-isolated
// so a failure in the read-only reporting step can never roll back or block
// the real state-changing drain, and vice versa. `drainInbox` and
// `listPeers` are themselves already fully self-contained (their own
// try/catch, never throw) — the wrapping here is defense-in-depth per the
// heartbeat-module invariant ("Heartbeat modules must never throw"), not a
// claim that this file is the first thing standing between a bad peer and a
// crashed tick.
//
// Kill-switch: CONCORD_FEDMESH_SYNC=0.

import logger from "../logger.js";

function fedmeshSyncEnabled() {
  return process.env.CONCORD_FEDMESH_SYNC !== "0";
}

// Conservative default: no declared intent to use derivatives/commercially.
// Same shape the fedmesh.drain macro defaults to when no policy is supplied.
const DEFAULT_DRAIN_POLICY = {};

/**
 * Heartbeat-compatible handler. Always returns a plain object, never throws.
 * @returns {{ok:boolean, reason?:string, drained?:{accepted:number,rejected:number}, peers?:{known:number,active:number,revoked:number}}}
 */
export async function runFedmeshSyncCycle({ db, state: _state, tickCount: _tickCount } = {}) {
  if (!fedmeshSyncEnabled()) return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let mod;
  try {
    mod = await import("../lib/federation-mesh.js");
  } catch (err) {
    return { ok: false, reason: "federation_mesh_unavailable", error: err?.message };
  }
  if (typeof mod.drainInbox !== "function" || typeof mod.listPeers !== "function") {
    return { ok: false, reason: "missing_exports" };
  }

  // Step 1 — the real state-changing sync action: drain the consent-gated
  // inbox against our default policy. Isolated so a failure in the
  // read-only peer-count step below can never roll it back.
  let drained = { accepted: 0, rejected: 0 };
  let drainOk = true;
  try {
    const r = mod.drainInbox(db, DEFAULT_DRAIN_POLICY);
    if (r && typeof r === "object") drained = r;
  } catch (err) {
    drainOk = false;
    try { logger.warn("fedmesh-sync-cycle", "drain_failed", { error: err?.message }); } catch { /* logging best-effort */ }
  }

  // Step 2 — peer-registry counts for observability. Read-only, best-effort,
  // never blocked by (and never blocks) the drain above.
  let peers = { known: 0, active: 0, revoked: 0 };
  try {
    const all = mod.listPeers(db, { includeRevoked: true }) || [];
    const revokedCount = all.filter((p) => !!p.revoked).length;
    peers = { known: all.length, active: all.length - revokedCount, revoked: revokedCount };
  } catch (err) {
    try { logger.warn("fedmesh-sync-cycle", "peer_list_failed", { error: err?.message }); } catch { /* logging best-effort */ }
  }

  if (!drainOk) return { ok: false, reason: "drain_threw", peers };
  return { ok: true, drained, peers };
}

export default { runFedmeshSyncCycle };
