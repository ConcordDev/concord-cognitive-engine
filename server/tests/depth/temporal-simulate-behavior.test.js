// tests/depth/temporal-simulate-behavior.test.js — REAL behavioral test for temporal.simulate
// (lens-audit: the temporal "simulate" button hit no macro until this deterministic
// trend-projection landed; reuses resolveSeries, same dataset handling as forecast).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

describe("temporal.simulate", () => {
  it("projects an upward series with the right trend + horizon", async () => {
    const r = await lensRun("temporal", "simulate", { params: { values: [10, 12, 13, 15, 16, 18, 19, 21], horizon: 3 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.horizon, 3);
    assert.ok(r.result.trendPerStep > 1, "detects the ~1.5/step uptrend");
    assert.equal(r.result.scenarios.expected.length, 3);
    assert.ok(r.result.finalExpected > r.result.lastValue, "projects continued growth");
    // optimistic band is above expected
    assert.ok(r.result.scenarios.optimistic[2] >= r.result.scenarios.expected[2]);
    assert.ok(r.result.scenarios.pessimistic[2] <= r.result.scenarios.expected[2]);
  });
  it("rejects too-short series", async () => {
    const r = await lensRun("temporal", "simulate", { params: { values: [1, 2] } });
    assert.equal(r.result.ok, false);
  });
});
