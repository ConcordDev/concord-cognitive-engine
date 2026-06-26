// G9 — chat rate limit. chat:message routes to the conscious brain (GPU), so an
// unthrottled spammer floods the LLM queue and starves real players. The handler
// gates each message through a per-user token bucket (makeEscalationBudget) BEFORE
// any brain work. This pins the bucket contract used there: a burst up to the cap,
// then sustained refill, keyed per user, with an injectable clock.
//
// Run: node --test tests/chat-rate-limit.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEscalationBudget } from "../lib/affect-salience.js";

test("G9 — chat bucket allows a burst then blocks the flood, per user", () => {
  const clock = 1_000_000;
  const PER_MIN = 60;
  const budget = makeEscalationBudget({ perWorldPerMin: PER_MIN, now: () => clock });

  // A single user's burst: the first PER_MIN messages pass instantly...
  let passed = 0;
  for (let i = 0; i < 200; i++) if (budget.tryConsume("userA")) passed++;
  assert.equal(passed, PER_MIN, "burst is capped at the bucket capacity");
  assert.equal(budget.tryConsume("userA"), false, "the flood's next message is dropped");

  // ...and a DIFFERENT user is unaffected (per-user keying — no collateral).
  assert.equal(budget.tryConsume("userB"), true, "another user is not rate-limited by userA's flood");
});

test("G9 — the bucket refills over time (sustained ~cap/min)", () => {
  let clock = 1_000_000;
  const budget = makeEscalationBudget({ perWorldPerMin: 60, now: () => clock });

  // Drain userA.
  for (let i = 0; i < 60; i++) budget.tryConsume("userA");
  assert.equal(budget.tryConsume("userA"), false, "drained");

  // 60/min = 1 token/sec; after 2s, ~2 tokens are back.
  clock += 2000;
  assert.equal(budget.tryConsume("userA"), true, "refilled after 1s");
  assert.equal(budget.tryConsume("userA"), true, "second refilled token");
  assert.equal(budget.tryConsume("userA"), false, "but not a third — sustained rate holds");
});
