import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMarketActions from "../domains/market.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`market.${name}`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerMarketActions(register); });
beforeEach(() => { globalThis._concordSTATE = { dtus: new Map() }; });
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("market parity macros", () => {
  it("sector-performance returns 11 sectors", () => {
    const r = call("sector-performance", ctxA, { range: "1D" });
    assert.equal(r.ok, true);
    assert.equal(r.result.sectors.length, 11);
    for (const s of r.result.sectors) {
      assert.ok(typeof s.pct === "number");
      assert.ok(s.marketCap > 0);
    }
  });

  it("sector-performance YTD amplifies pct vs 1D", () => {
    const d = call("sector-performance", ctxA, { range: "1D" });
    const y = call("sector-performance", ctxA, { range: "YTD" });
    const dMax = Math.max(...d.result.sectors.map(s => Math.abs(s.pct)));
    const yMax = Math.max(...y.result.sectors.map(s => Math.abs(s.pct)));
    assert.ok(yMax > dMax);
  });

  it("quotes-batch returns N quotes with full shape", () => {
    const r = call("quotes-batch", ctxA, { symbols: ["AAPL", "MSFT", "TSLA"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.quotes.length, 3);
    assert.equal(r.result.quotes[0].symbol, "AAPL");
    for (const q of r.result.quotes) {
      assert.ok(q.price > 0); assert.ok(q.marketCap > 0);
    }
  });

  it("quotes-batch handles empty input", () => {
    const r = call("quotes-batch", ctxA, { symbols: [] });
    assert.deepEqual(r.result.quotes, []);
  });
});
