// server/lib/socket-rate-limit.js
//
// Adversarial-hardening: per-user token-bucket rate limiting for HOT raw socket
// events. HTTP routes pass through rateLimit.js, but raw socket.io events
// (combat:attack, chat, player:move) bypass that entirely — a scripted client
// can fire thousands of combat:attack events per second straight at the damage
// math / broadcast fan-out. The per-action attack COOLDOWN bounds rate per
// action class, but a token bucket is the clean per-USER cap that also covers
// burst floods across classes and refills smoothly over time.
//
// This is the same continuous-refill token bucket as affect-salience.js
// `makeEscalationBudget`, generalized to key by userId and configured per
// event type. Pure stateful object with an injectable clock for tests.
//
//   makeSocketRateLimiter({ ratePerSec, burst, now }) -> { tryConsume, peek, _state }

/**
 * Build a per-key token bucket.
 *
 * @param {object} [opts]
 * @param {number} [opts.ratePerSec=10]  sustained tokens granted per second
 * @param {number} [opts.burst]          bucket capacity (defaults to ratePerSec, min 1)
 * @param {() => number} [opts.now]      injectable clock (ms)
 * @returns {{ tryConsume:(key?:string, cost?:number, t?:number)=>boolean,
 *             peek:(key?:string, t?:number)=>number, _state: Map<string, object> }}
 */
export function makeSocketRateLimiter({ ratePerSec = 10, burst, now = () => Date.now() } = {}) {
  const rate = Math.max(0.001, Number(ratePerSec) || 10);
  const cap = Math.max(1, Number(burst) || rate);
  const refillPerMs = rate / 1000;
  const state = new Map(); // key -> { tokens, last }

  function _bucket(key, t) {
    let b = state.get(key);
    if (!b) { b = { tokens: cap, last: t }; state.set(key, b); return b; }
    const elapsed = Math.max(0, t - b.last);
    b.tokens = Math.min(cap, b.tokens + elapsed * refillPerMs);
    b.last = t;
    return b;
  }

  return {
    /**
     * Try to spend `cost` tokens for `key`. Returns true and deducts when the
     * bucket has enough; false (no deduction) when exhausted. Never throws.
     */
    tryConsume(key = "_global", cost = 1, t = now()) {
      const need = Math.max(0, Number(cost) || 0);
      const b = _bucket(key, t);
      if (b.tokens >= need) { b.tokens -= need; return true; }
      return false;
    },
    /** Current token balance for a key (refilled to `t`). */
    peek(key = "_global", t = now()) { return _bucket(key, t).tokens; },
    _state: state,
  };
}

// Default caps (env-overridable). Combat is the hottest, most damaging event;
// chat reuses the existing CONCORD_CHAT_PER_MIN convention from the chat path.
export const SOCKET_RATE_DEFAULTS = Object.freeze({
  combatPerSec: Number(process.env.CONCORD_SOCKET_COMBAT_PER_SEC) || 10,
  combatBurst:  Number(process.env.CONCORD_SOCKET_COMBAT_BURST) || 15,
});
