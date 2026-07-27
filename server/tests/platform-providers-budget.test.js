// server/tests/platform-providers-budget.test.js
//
// Task #34 of the Private Mode / High Power Mode plan: dedicated tests for
// server/lib/platform-providers-budget.js -- the global (not per-user)
// token bucket protecting the OPERATOR's own platform-provider keys from
// unbounded exposure. Deliberately fail-CLOSED (the opposite trust
// direction from byo-rate-limit.js, which protects a USER's own key and
// fails open).

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import {
  consumePlatformToken,
  getPlatformBudgetStatus,
  recordPlatformSpendEstimate,
  RATE_LIMIT_WINDOW_MS,
} from "../lib/platform-providers-budget.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  globalThis._concordSTATE = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("CONCORD_PLATFORM_RPM_")) delete process.env[k];
  }
});

after(() => { process.env = { ...ORIGINAL_ENV }; });

describe("consumePlatformToken — fail-closed gate", () => {
  it("rejects an invalid provider", () => {
    const r = consumePlatformToken("not_a_real_provider", "conscious");
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "invalid_provider_or_slot");
  });

  it("rejects an invalid slot", () => {
    const r = consumePlatformToken("groq", "not_a_real_slot");
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "invalid_provider_or_slot");
  });

  it("fails closed (denies) when globalThis._concordSTATE is unavailable", () => {
    globalThis._concordSTATE = undefined;
    const r = consumePlatformToken("groq", "conscious");
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "state_unavailable");
  });

  it("an allowed call consumes exactly one token and reports the configured maxPerMinute", () => {
    const first = consumePlatformToken("groq", "conscious", 1_000_000);
    assert.equal(first.allowed, true);
    assert.equal(first.reason, "within_limit");
    assert.equal(first.maxPerMinute, 30); // groq's verified 30 RPM default

    const status = getPlatformBudgetStatus(1_000_000);
    const bucket = status.buckets.find((b) => b.provider === "groq" && b.slot === "conscious");
    assert.equal(bucket.remaining, 29);
  });

  it("exhausting the bucket returns allowed:false with a positive retryAfterMs", () => {
    process.env.CONCORD_PLATFORM_RPM_GROQ_CONSCIOUS = "2";
    const now = 1_000_000;
    assert.equal(consumePlatformToken("groq", "conscious", now).allowed, true);
    assert.equal(consumePlatformToken("groq", "conscious", now).allowed, true);
    const third = consumePlatformToken("groq", "conscious", now);
    assert.equal(third.allowed, false);
    assert.equal(third.reason, "platform_budget_exhausted");
    assert.ok(Number.isFinite(third.retryAfterMs) && third.retryAfterMs > 0);
  });

  it("refills over time — a token becomes available again after the window elapses", () => {
    process.env.CONCORD_PLATFORM_RPM_GROQ_CONSCIOUS = "1";
    const t0 = 1_000_000;
    assert.equal(consumePlatformToken("groq", "conscious", t0).allowed, true);
    assert.equal(consumePlatformToken("groq", "conscious", t0).allowed, false, "bucket of 1 must be empty on the 2nd call at the same instant");

    // A full RATE_LIMIT_WINDOW_MS later, the single-token bucket should
    // have fully refilled.
    const t1 = t0 + RATE_LIMIT_WINDOW_MS;
    assert.equal(consumePlatformToken("groq", "conscious", t1).allowed, true);
  });

  it("respects a CONCORD_PLATFORM_RPM_<PROVIDER>_<SLOT> override", () => {
    process.env.CONCORD_PLATFORM_RPM_MISTRAL_UTILITY = "5";
    const r = consumePlatformToken("mistral", "utility", 1_000_000);
    assert.equal(r.allowed, true);
    assert.equal(r.maxPerMinute, 5);
  });

  it("per-(provider,slot) buckets are independent — exhausting one never affects another", () => {
    process.env.CONCORD_PLATFORM_RPM_GROQ_CONSCIOUS = "1";
    const now = 1_000_000;
    assert.equal(consumePlatformToken("groq", "conscious", now).allowed, true);
    assert.equal(consumePlatformToken("groq", "conscious", now).allowed, false);
    // Different slot, same provider -- separate bucket.
    assert.equal(consumePlatformToken("groq", "utility", now).allowed, true);
    // Different provider, same slot -- separate bucket.
    assert.equal(consumePlatformToken("google", "conscious", now).allowed, true);
  });
});

describe("getPlatformBudgetStatus", () => {
  it("read-only — calling it never consumes a token", () => {
    consumePlatformToken("groq", "conscious", 1_000_000);
    const before = getPlatformBudgetStatus(1_000_000).buckets.find((b) => b.provider === "groq").remaining;
    getPlatformBudgetStatus(1_000_000);
    getPlatformBudgetStatus(1_000_000);
    const after = getPlatformBudgetStatus(1_000_000).buckets.find((b) => b.provider === "groq").remaining;
    assert.equal(before, after);
  });

  it("fails closed when state is unavailable", () => {
    globalThis._concordSTATE = undefined;
    const r = getPlatformBudgetStatus();
    assert.equal(r.ok, false);
    assert.equal(r.reason, "state_unavailable");
  });

  it("reports an empty bucket list when nothing has been touched yet", () => {
    const r = getPlatformBudgetStatus();
    assert.equal(r.ok, true);
    assert.deepEqual(r.buckets, []);
  });
});

describe("recordPlatformSpendEstimate", () => {
  it("accumulates spend across calls and getPlatformBudgetStatus surfaces the running total", () => {
    recordPlatformSpendEstimate(0.5);
    recordPlatformSpendEstimate(0.25);
    const status = getPlatformBudgetStatus();
    assert.equal(status.dailySpendUsd, 0.75);
  });

  it("ignores a non-finite amount without throwing", () => {
    recordPlatformSpendEstimate(NaN);
    recordPlatformSpendEstimate(undefined);
    recordPlatformSpendEstimate(0.1);
    const status = getPlatformBudgetStatus();
    assert.equal(status.dailySpendUsd, 0.1);
  });

  it("is a no-op (does not throw) when state is unavailable", () => {
    globalThis._concordSTATE = undefined;
    recordPlatformSpendEstimate(1.0); // must not throw
  });
});
