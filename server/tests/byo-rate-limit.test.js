// server/tests/byo-rate-limit.test.js
//
// Tier-2 contract tests for the BYO-keys per-key rate-limiting gap
// closure (docs/lens-specs/byo-keys-capability-map.md item #9:
// "Per-key rate limiting (requests/minute, not just monthly $ cap)").
//
// Two units under test:
//   - server/lib/byo-rate-limit.js — the pure token-bucket core
//     (setRateLimit / getRateLimitStatus / consumeRateLimitToken).
//   - server/domains/byo-keys.js#registerByoKeysMacros — the
//     `rate_limit_set` / `rate_limit_status` macros that wrap it for
//     the lens UI.
//
// The router-side enforcement wiring (server/lib/byo-router.js#brainChat
// calling consumeRateLimitToken BEFORE decrypting the key / contacting
// the provider) is pinned separately in
// server/tests/byo-rate-limit-router.test.js, which exercises the real
// brainChat() call path end-to-end.
//
// No server boot, no DB_PATH needed — every unit here is pure
// _concordSTATE-backed logic, same harness shape as
// server/tests/byo-budget-alert-cycle.test.js (this session's sibling
// gap-closure unit, item #10).
//
// Clock injection: every core function accepts an explicit `nowMs`
// parameter, so "the window resets after a minute" is tested by
// advancing a fake clock value — never a real sleep/setTimeout.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerByoKeysMacros from "../domains/byo-keys.js";
import {
  RATE_LIMIT_WINDOW_MS,
  setRateLimit,
  getRateLimitStatus,
  consumeRateLimitToken,
} from "../lib/byo-rate-limit.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`byo_keys.${name}`);
  if (!fn) throw new Error(`byo_keys.${name} not registered`);
  return fn(ctx, input);
}

registerByoKeysMacros(register);

function ctxFor(userId) {
  return { actor: { userId }, userId };
}

beforeEach(() => {
  // Fresh STATE per test — both stateRoot() implementations (this
  // domain's own branches + byo-rate-limit.js's `rateLimits` branch)
  // lazily attach onto whatever object globalThis._concordSTATE points
  // at, so a brand-new object is full isolation.
  globalThis._concordSTATE = {};
});

describe("byo-rate-limit core — setRateLimit / getRateLimitStatus / consumeRateLimitToken", () => {
  it("RATE_LIMIT_WINDOW_MS is one minute", () => {
    assert.equal(RATE_LIMIT_WINDOW_MS, 60_000);
  });

  it("with no limit configured, consumeRateLimitToken always allows (fail-open)", () => {
    for (let i = 0; i < 50; i++) {
      const r = consumeRateLimitToken("user_a", "conscious", 1_000 * i);
      assert.equal(r.allowed, true);
      assert.equal(r.reason, "no_limit_set");
    }
  });

  it("consumeRateLimitToken fails open for a missing actor or an invalid slot", () => {
    assert.equal(consumeRateLimitToken(null, "conscious").allowed, true);
    assert.equal(consumeRateLimitToken("user_a", "not_a_real_slot").allowed, true);
  });

  it("setRateLimit rejects a missing actor or invalid slot", () => {
    assert.deepEqual(setRateLimit(null, "conscious", 5), { ok: false, reason: "no_actor" });
    assert.deepEqual(setRateLimit("user_a", "ghost_slot", 5), { ok: false, reason: "invalid_slot" });
  });

  it("setRateLimit clears the limit when maxPerMinute is null/0/negative", () => {
    setRateLimit("user_a", "conscious", 3);
    let s = getRateLimitStatus("user_a");
    assert.equal(s.result.slots.length, 1);

    const cleared = setRateLimit("user_a", "conscious", null);
    assert.deepEqual(cleared.result, { slot: "conscious", rateLimit: null });
    s = getRateLimitStatus("user_a");
    assert.equal(s.result.slots.length, 0);

    setRateLimit("user_a", "conscious", 3);
    const cleared2 = setRateLimit("user_a", "conscious", 0);
    assert.equal(cleared2.result.rateLimit, null);
  });

  it("setRateLimit floors fractional caps and clamps below 1 up to 1", () => {
    const r1 = setRateLimit("user_a", "conscious", 4.9);
    assert.equal(r1.result.rateLimit.maxPerMinute, 4);
    const r2 = setRateLimit("user_a", "utility", 0.3);
    assert.equal(r2.result.rateLimit.maxPerMinute, 1);
  });

  it("requests strictly under the limit all succeed (allowed:true, token consumed)", () => {
    setRateLimit("user_a", "conscious", 5);
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      const r = consumeRateLimitToken("user_a", "conscious", now);
      assert.equal(r.allowed, true, `request ${i + 1} of 5 should be allowed`);
      assert.equal(r.reason, "within_limit");
      assert.equal(r.remaining, 5 - (i + 1));
    }
  });

  it("the request that exceeds the limit is rejected with a positive retryAfterMs", () => {
    setRateLimit("user_a", "conscious", 3);
    const now = 2_000_000;
    for (let i = 0; i < 3; i++) {
      assert.equal(consumeRateLimitToken("user_a", "conscious", now).allowed, true);
    }
    const blocked = consumeRateLimitToken("user_a", "conscious", now);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reason, "rate_limited");
    assert.ok(Number.isFinite(blocked.retryAfterMs) && blocked.retryAfterMs > 0);
    assert.equal(blocked.maxPerMinute, 3);
  });

  it("a rejected request does not consume a token — the next allowed request still gets one", () => {
    setRateLimit("user_a", "conscious", 1);
    const now = 3_000_000;
    assert.equal(consumeRateLimitToken("user_a", "conscious", now).allowed, true);
    // Exhausted — repeated calls at the same instant keep rejecting.
    assert.equal(consumeRateLimitToken("user_a", "conscious", now).allowed, false);
    assert.equal(consumeRateLimitToken("user_a", "conscious", now).allowed, false);
    // Advancing to a fully-refilled instant allows exactly one more.
    const later = now + RATE_LIMIT_WINDOW_MS;
    assert.equal(consumeRateLimitToken("user_a", "conscious", later).allowed, true);
    assert.equal(consumeRateLimitToken("user_a", "conscious", later).allowed, false);
  });

  it("the window resets after RATE_LIMIT_WINDOW_MS elapses (simulated clock, no real sleep)", () => {
    setRateLimit("user_a", "conscious", 2);
    const t0 = 10_000_000;
    assert.equal(consumeRateLimitToken("user_a", "conscious", t0).allowed, true);
    assert.equal(consumeRateLimitToken("user_a", "conscious", t0).allowed, true);
    assert.equal(consumeRateLimitToken("user_a", "conscious", t0).allowed, false, "3rd request at t0 must be blocked");

    // Halfway through the window: continuous refill grants ~1 token back
    // (2/min cap -> 1 token per 30s), so exactly one more request should
    // succeed, not two.
    const tHalf = t0 + RATE_LIMIT_WINDOW_MS / 2;
    assert.equal(consumeRateLimitToken("user_a", "conscious", tHalf).allowed, true, "half-window refill should grant ~1 token");
    assert.equal(consumeRateLimitToken("user_a", "conscious", tHalf).allowed, false);

    // A full window after that: bucket is fully refilled to the 2-token cap.
    const tFull = tHalf + RATE_LIMIT_WINDOW_MS;
    assert.equal(consumeRateLimitToken("user_a", "conscious", tFull).allowed, true);
    assert.equal(consumeRateLimitToken("user_a", "conscious", tFull).allowed, true);
    assert.equal(consumeRateLimitToken("user_a", "conscious", tFull).allowed, false, "still capped at 2 even after a full refill");
  });

  it("lowering the cap immediately re-clamps existing tokens; raising it does not grant a retroactive burst", () => {
    setRateLimit("user_a", "conscious", 10);
    let status = getRateLimitStatus("user_a", 0);
    assert.equal(status.result.slots[0].remaining, 10);

    setRateLimit("user_a", "conscious", 2);
    status = getRateLimitStatus("user_a", 0);
    assert.equal(status.result.slots[0].remaining, 2, "lowering the cap must clamp current tokens down immediately");

    setRateLimit("user_a", "conscious", 20);
    status = getRateLimitStatus("user_a", 0);
    assert.equal(status.result.slots[0].remaining, 2, "raising the cap must not retroactively refill beyond what was already banked");
  });

  it("per-slot isolation — exhausting one slot does not affect another slot for the same user", () => {
    setRateLimit("user_a", "conscious", 1);
    setRateLimit("user_a", "utility", 1);
    const now = 5_000_000;
    assert.equal(consumeRateLimitToken("user_a", "conscious", now).allowed, true);
    assert.equal(consumeRateLimitToken("user_a", "conscious", now).allowed, false);
    // Utility slot is untouched.
    assert.equal(consumeRateLimitToken("user_a", "utility", now).allowed, true);
  });

  it("per-user isolation — exhausting user A's bucket does not affect user B's", () => {
    setRateLimit("user_a", "conscious", 1);
    setRateLimit("user_b", "conscious", 1);
    const now = 6_000_000;
    assert.equal(consumeRateLimitToken("user_a", "conscious", now).allowed, true);
    assert.equal(consumeRateLimitToken("user_a", "conscious", now).allowed, false);
    assert.equal(consumeRateLimitToken("user_b", "conscious", now).allowed, true, "user B's own bucket must be independent");
  });

  it("getRateLimitStatus only lists slots with a configured limit, and never consumes a token", () => {
    setRateLimit("user_a", "conscious", 5);
    const before = getRateLimitStatus("user_a", 0);
    assert.equal(before.result.slots.length, 1);
    assert.equal(before.result.slots[0].slot, "conscious");
    assert.equal(before.result.slots[0].remaining, 5);

    // Polling status repeatedly must not drain the bucket.
    getRateLimitStatus("user_a", 0);
    getRateLimitStatus("user_a", 0);
    const after = getRateLimitStatus("user_a", 0);
    assert.equal(after.result.slots[0].remaining, 5);
  });
});

describe("byo_keys.rate_limit_set / rate_limit_status macros", () => {
  it("rate_limit_set requires an actor", async () => {
    const r = await call("rate_limit_set", { actor: {} }, { slot: "conscious", maxPerMinute: 5 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_actor");
  });

  it("rate_limit_set persists a cap that rate_limit_status then reports", async () => {
    const set = await call("rate_limit_set", ctxFor("user_a"), { slot: "conscious", maxPerMinute: 10 });
    assert.equal(set.ok, true);
    assert.equal(set.result.rateLimit.maxPerMinute, 10);

    const status = await call("rate_limit_status", ctxFor("user_a"));
    assert.equal(status.ok, true);
    assert.equal(status.result.slots.length, 1);
    assert.equal(status.result.slots[0].slot, "conscious");
    assert.equal(status.result.slots[0].maxPerMinute, 10);
    assert.equal(status.result.slots[0].remaining, 10);
  });

  it("rate_limit_set with no maxPerMinute clears an existing cap", async () => {
    await call("rate_limit_set", ctxFor("user_a"), { slot: "conscious", maxPerMinute: 10 });
    const cleared = await call("rate_limit_set", ctxFor("user_a"), { slot: "conscious" });
    assert.equal(cleared.result.rateLimit, null);
    const status = await call("rate_limit_status", ctxFor("user_a"));
    assert.equal(status.result.slots.length, 0);
  });

  it("rate_limit_status isolates per user through the macro layer too", async () => {
    await call("rate_limit_set", ctxFor("user_a"), { slot: "conscious", maxPerMinute: 3 });
    const statusB = await call("rate_limit_status", ctxFor("user_b"));
    assert.equal(statusB.ok, true);
    assert.deepEqual(statusB.result.slots, []);
  });

  it("the macro layer and the plain lib functions share state (same substrate, not two implementations)", async () => {
    await call("rate_limit_set", ctxFor("user_a"), { slot: "repair", maxPerMinute: 2 });
    // Consume directly through the lib function, using the real clock
    // (no injected timestamp) so it stays consistent with the macro's
    // own default-Date.now() call a few milliseconds later — an
    // injected timestamp far in the past here would look like a huge
    // elapsed gap to the macro's real-time status read and refill the
    // bucket back up, masking the very depletion this test checks for.
    consumeRateLimitToken("user_a", "repair");
    consumeRateLimitToken("user_a", "repair");
    // ...and observe the depletion through the macro.
    const status = await call("rate_limit_status", ctxFor("user_a"));
    assert.equal(status.result.slots[0].remaining, 0);
  });
});
