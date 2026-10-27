// finance.simulate used to answer a missing price history with mean 100.
// The guard is pure so this file does not boot server.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickCount, unavailableTradeSimulation } from "../lib/finance-simulate-guard.js";

describe("finance simulate honesty", () => {
  it("does not invent a price of 100 when history is missing", () => {
    const r = unavailableTradeSimulation(0);
    assert.equal(r.ok, false);
    assert.equal(r.error, "unavailable");
    assert.equal(r.reason, "insufficient_trade_history");
    assert.equal(r.currentPrice, null);
    assert.equal(JSON.stringify(r).includes("100"), false);
  });

  it("keeps a real current price as context and still refuses to simulate", () => {
    const r = unavailableTradeSimulation(42);
    assert.equal(r.ok, false);
    assert.equal(r.currentPrice, 42);
    assert.equal(r.reason, "insufficient_trade_history");
  });

  it("pickCount uses the fallback only when the count is omitted", () => {
    assert.deepEqual(pickCount(undefined, 1000, 1, 10000), { n: 1000 });
    assert.deepEqual(pickCount("", 30, 1, 3650), { n: 30 });
    assert.deepEqual(pickCount(12.9, 30, 1, 3650), { n: 12 });
    assert.equal(pickCount("not-a-count", 30, 1, 3650).error, true);
  });
});
