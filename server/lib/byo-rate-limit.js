// server/lib/byo-rate-limit.js
//
// Wave 4 gap-closure — docs/lens-specs/byo-keys-capability-map.md item #9:
// "Per-key rate limiting (requests/minute, not just monthly $ cap)".
//
// A real, continuous-refill token bucket per (userId, slot) — the same
// bucket algorithm already used for socket-event flood protection
// (server/lib/socket-rate-limit.js#makeSocketRateLimiter /
// affect-salience.js#makeEscalationBudget), generalized here to a
// requests-per-minute cadence and backed by a lazily-created branch of
// the byo-keys lens's own `_concordSTATE.byoKeysLens` namespace (see
// server/domains/byo-keys.js#stateRoot) so it shares storage/reset
// lifecycle with the rest of that lens's per-user substrates (usage,
// budgets, fallback, health, alerts) without owning that object.
//
// Lives in server/lib/, not server/domains/, because it must be
// import-safe from server/lib/byo-router.js — the actual outbound-call
// dispatch chokepoint for every BYO-key inference (chat, expert-mode,
// reason.verify, agent-marathon, maker-checker, llm.local, and any
// future brainChat() caller). No server/lib/*.js file imports from
// server/domains/*.js anywhere in this codebase (grep confirms zero
// instances) — the enforcement core lives here and
// server/domains/byo-keys.js imports it for the user-facing macros,
// preserving that one-directional layering.
//
// Fail-open by design: an actor with no configured limit, or a
// corrupted/absent state root, is always `allowed: true`. A rate limit
// is an opt-in user protection (e.g. "don't let a runaway loop burn
// through my OpenAI budget"), not a platform-wide throttle — it must
// never be the reason a user's own correctly-configured key silently
// stops working.

const VALID_SLOTS = new Set(["conscious", "subconscious", "utility", "repair", "vision"]);

/** Rolling window width. Exported so tests can reason about the cadence explicitly. */
export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

/**
 * Canonical, single-owner initializer for
 * `globalThis._concordSTATE.byoKeysLens` — the one place this object's
 * full shape is defined, shared by server/domains/byo-keys.js (its
 * `usage`/`budgets`/`fallback`/`health`/`orgKeys`/`alerts` branches) and
 * this file (`rateLimits`). It lives here rather than in the domain file
 * because this module must be import-safe from server/lib/byo-router.js,
 * and no server/lib/*.js file imports from server/domains/*.js anywhere
 * in this codebase — so the domain file imports this initializer instead
 * of duplicating it.
 *
 * Deliberately a SINGLE whole-object gate (`if (!s.byoKeysLens)`), not a
 * per-branch one: existing contract tests (e.g.
 * server/tests/byo-budget-alert-cycle.test.js's "never throws when the
 * underlying state is malformed") intentionally null out a branch after
 * first init to exercise a caller's own try/catch — a per-branch
 * self-healing init would silently repair that corruption and defeat
 * the test. One-time creation, same as the pre-existing behavior this
 * replaces.
 */
export function ensureByoKeysLensState() {
  const s = globalThis._concordSTATE;
  if (!s) return null;
  if (!s.byoKeysLens) {
    s.byoKeysLens = {
      usage: new Map(),      // userId -> Map<slot, { events:[], totals:{} }>
      budgets: new Map(),    // userId -> Map<slot, { monthlyUsdCap, monthlyTokenCap }>
      fallback: new Map(),   // userId -> Map<slot, string[]>  (ordered fallback slots)
      health: new Map(),     // userId -> Map<slot, { lastError, lastErrorAt, lastOkAt, status }>
      orgKeys: new Map(),    // orgId  -> { ownerId, label, provider, members:Map<userId,role> }
      alerts: new Map(),     // userId -> Map<slot, { month, threshold }>  (spend-alert dedupe)
      rateLimits: new Map(), // userId -> Map<slot, { maxPerMinute, tokens, lastRefillMs }>  (this file)
    };
  }
  return s.byoKeysLens;
}

function stateRoot() {
  return ensureByoKeysLensState();
}

function bucketMapFor(userId) {
  const root = stateRoot();
  if (!root) return null;
  if (!root.rateLimits.has(userId)) root.rateLimits.set(userId, new Map());
  return root.rateLimits.get(userId);
}

/** Refill a bucket up to `nowMs`, in place. Mutates + returns the bucket. */
function refill(bucket, nowMs) {
  const elapsedMs = Math.max(0, nowMs - bucket.lastRefillMs);
  const refillPerMs = bucket.maxPerMinute / RATE_LIMIT_WINDOW_MS;
  bucket.tokens = Math.min(bucket.maxPerMinute, bucket.tokens + elapsedMs * refillPerMs);
  bucket.lastRefillMs = nowMs;
  return bucket;
}

/**
 * Set (or clear) a per-slot requests-per-minute cap for a user.
 * Passing `maxPerMinute` as null/0/undefined clears the limit for that slot.
 *
 * @param {string} userId
 * @param {string} slot            brain slot (conscious|subconscious|utility|repair|vision)
 * @param {number|null} maxPerMinute
 * @returns {{ok, reason?, result?}}
 */
export function setRateLimit(userId, slot, maxPerMinute) {
  if (!userId) return { ok: false, reason: "no_actor" };
  if (!VALID_SLOTS.has(slot)) return { ok: false, reason: "invalid_slot" };
  const bm = bucketMapFor(userId);
  if (!bm) return { ok: false, reason: "state_unavailable" };

  const n = maxPerMinute == null ? null : Number(maxPerMinute);
  if (n == null || !Number.isFinite(n) || n <= 0) {
    bm.delete(slot);
    return { ok: true, result: { slot, rateLimit: null } };
  }

  const max = Math.max(1, Math.floor(n));
  const existing = bm.get(slot);
  bm.set(slot, {
    maxPerMinute: max,
    // Re-clamp existing tokens to the new cap so lowering the limit takes
    // effect immediately; raising it doesn't retroactively grant a burst.
    tokens: existing ? Math.min(max, existing.tokens) : max,
    lastRefillMs: existing ? existing.lastRefillMs : Date.now(),
  });
  return { ok: true, result: { slot, rateLimit: { maxPerMinute: max } } };
}

/**
 * Read-only status for every slot that has a rate limit configured.
 * Does NOT consume a token — safe to poll from the UI.
 *
 * @param {string} userId
 * @param {number} [nowMs]
 * @returns {{ok, reason?, result?: {slots: Array}}}
 */
export function getRateLimitStatus(userId, nowMs = Date.now()) {
  if (!userId) return { ok: false, reason: "no_actor" };
  const bm = bucketMapFor(userId);
  if (!bm) return { ok: false, reason: "state_unavailable" };

  const slots = [];
  for (const slot of VALID_SLOTS) {
    const bucket = bm.get(slot);
    if (!bucket) continue;
    refill(bucket, nowMs);
    const refillPerMs = bucket.maxPerMinute / RATE_LIMIT_WINDOW_MS;
    const remaining = Math.floor(bucket.tokens);
    const nextTokenInMs = bucket.tokens >= 1 ? 0 : Math.max(0, Math.ceil((1 - bucket.tokens) / refillPerMs));
    slots.push({ slot, maxPerMinute: bucket.maxPerMinute, remaining, nextTokenInMs });
  }
  return { ok: true, result: { slots } };
}

/**
 * The enforcement gate. Call this once per outbound BYO-key inference
 * attempt, BEFORE decrypting the key or contacting the provider —
 * server/lib/byo-router.js#brainChat is the real caller. Consumes one
 * token when allowed; never consumes when rejected.
 *
 * Fail-open: no actor, an invalid slot, no configured limit, or an
 * unavailable state root all resolve to `allowed: true` — this gate
 * exists to protect the user from their OWN runaway usage, never to
 * block a correctly-configured key on an infra hiccup.
 *
 * @param {string} userId
 * @param {string} slot
 * @param {number} [nowMs]
 * @returns {{allowed: boolean, reason: string, remaining?: number, maxPerMinute?: number, retryAfterMs?: number}}
 */
export function consumeRateLimitToken(userId, slot, nowMs = Date.now()) {
  if (!userId || !VALID_SLOTS.has(slot)) return { allowed: true, reason: "no_actor_or_invalid_slot" };
  const bm = bucketMapFor(userId);
  if (!bm) return { allowed: true, reason: "state_unavailable" };
  const bucket = bm.get(slot);
  if (!bucket) return { allowed: true, reason: "no_limit_set" };

  refill(bucket, nowMs);
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, reason: "within_limit", remaining: Math.floor(bucket.tokens), maxPerMinute: bucket.maxPerMinute };
  }
  const refillPerMs = bucket.maxPerMinute / RATE_LIMIT_WINDOW_MS;
  const retryAfterMs = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs));
  return { allowed: false, reason: "rate_limited", retryAfterMs, maxPerMinute: bucket.maxPerMinute };
}

/** @internal exposed for the byo-keys domain macros' input validation. */
export function isValidSlot(slot) {
  return VALID_SLOTS.has(slot);
}
