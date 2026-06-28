/**
 * Adversarial-hardening — socket-event token bucket contract test.
 *
 * Pins: the bucket rejects once exhausted (a flood past the burst cap is
 * dropped), refills over time with an injectable clock, and different keys
 * have independent buckets. Never throws.
 *
 * Run: node --test tests/socket-rate-limit.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeSocketRateLimiter, SOCKET_RATE_DEFAULTS } from "../lib/socket-rate-limit.js";

describe("makeSocketRateLimiter", () => {
  it("allows up to the burst cap then rejects", () => {
    let t = 0;
    const rl = makeSocketRateLimiter({ ratePerSec: 10, burst: 5, now: () => t });
    // 5 tokens in the bucket at t=0 (no time passes between calls).
    for (let i = 0; i < 5; i++) {
      assert.equal(rl.tryConsume("user-a", 1, t), true, `consume ${i} should pass`);
    }
    // 6th is over the burst → dropped.
    assert.equal(rl.tryConsume("user-a", 1, t), false);
  });

  it("refills over time", () => {
    let t = 0;
    const rl = makeSocketRateLimiter({ ratePerSec: 10, burst: 5, now: () => t });
    for (let i = 0; i < 5; i++) rl.tryConsume("u", 1, t);
    assert.equal(rl.tryConsume("u", 1, t), false); // exhausted at t=0

    // 10 tokens/sec → 100ms grants 1 token.
    t = 100;
    assert.equal(rl.tryConsume("u", 1, t), true);
    assert.equal(rl.tryConsume("u", 1, t), false); // only one refilled

    // 500ms more → 5 more tokens, capped at burst=5.
    t = 600;
    for (let i = 0; i < 5; i++) assert.equal(rl.tryConsume("u", 1, t), true);
    assert.equal(rl.tryConsume("u", 1, t), false);
  });

  it("never refills past the burst cap", () => {
    let t = 0;
    const rl = makeSocketRateLimiter({ ratePerSec: 10, burst: 5, now: () => t });
    rl.tryConsume("u", 1, t); // 4 left
    t = 10_000; // huge idle — would be 100 tokens uncapped
    assert.equal(rl.peek("u", t), 5); // capped at burst
  });

  it("keeps independent buckets per key", () => {
    let t = 0;
    const rl = makeSocketRateLimiter({ ratePerSec: 10, burst: 2, now: () => t });
    assert.equal(rl.tryConsume("alice", 1, t), true);
    assert.equal(rl.tryConsume("alice", 1, t), true);
    assert.equal(rl.tryConsume("alice", 1, t), false); // alice exhausted
    // bob has his own full bucket
    assert.equal(rl.tryConsume("bob", 1, t), true);
    assert.equal(rl.tryConsume("bob", 1, t), true);
  });

  it("supports a multi-token cost", () => {
    let t = 0;
    const rl = makeSocketRateLimiter({ ratePerSec: 10, burst: 5, now: () => t });
    assert.equal(rl.tryConsume("u", 3, t), true); // 2 left
    assert.equal(rl.tryConsume("u", 3, t), false); // not enough
    assert.equal(rl.tryConsume("u", 2, t), true);
  });

  it("never throws on odd input", () => {
    const rl = makeSocketRateLimiter({ ratePerSec: 10, burst: 5 });
    assert.doesNotThrow(() => rl.tryConsume());
    assert.doesNotThrow(() => rl.tryConsume(undefined, NaN));
    assert.doesNotThrow(() => rl.peek());
  });

  it("exposes sane env-derived defaults", () => {
    assert.ok(SOCKET_RATE_DEFAULTS.combatPerSec > 0);
    assert.ok(SOCKET_RATE_DEFAULTS.combatBurst >= SOCKET_RATE_DEFAULTS.combatPerSec);
  });
});
