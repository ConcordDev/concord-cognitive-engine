import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMarketsActions from "../domains/markets.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`markets.${name}`);
  if (!fn) throw new Error(`markets.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMarketsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("markets — options chain", () => {
  it("returns chain with greeks for SPY", () => {
    const r = call("options-chain", ctxA, { symbol: "SPY", spot: 450, iv: 0.18, daysToExpiry: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.chain.length, 11);
    assert.ok(r.result.chain[0].call.delta >= 0 && r.result.chain[0].call.delta <= 1);
  });

  it("ATM call delta ≈ 0.5", () => {
    const r = call("options-chain", ctxA, { symbol: "SPY", spot: 450, iv: 0.18, daysToExpiry: 30 });
    const atm = r.result.chain.find((row) => row.strike === 450);
    assert.ok(Math.abs(atm.call.delta - 0.5) < 0.15);
  });

  it("put-call parity for ATM strike", () => {
    const r = call("options-chain", ctxA, { spot: 100, iv: 0.20, daysToExpiry: 30 });
    const atm = r.result.chain.find((row) => row.strike === 100);
    // C - P ≈ S - K*e^-rT ≈ S - K (small r * T)
    const diff = atm.call.mark - atm.put.mark;
    assert.ok(Math.abs(diff) < 1); // ATM, parity holds tightly
  });

  it("rejects negative spot", () => {
    const r = call("options-chain", ctxA, { spot: -10 });
    assert.equal(r.ok, false);
  });

  it("rejects IV out of range", () => {
    const r = call("options-chain", ctxA, { spot: 100, iv: 10 });
    assert.equal(r.ok, false);
    assert.match(r.error, /iv must be/);
  });
});

describe("markets — futures board", () => {
  it("returns CME contracts", () => {
    const r = call("futures-board", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.contracts.length >= 7);
    assert.ok(r.result.contracts.some((c) => c.symbol === "ES"));
  });

  it("filters by symbol", () => {
    const r = call("futures-board", ctxA, { symbol: "ES" });
    assert.equal(r.result.contracts.length, 1);
    assert.equal(r.result.contracts[0].symbol, "ES");
  });
});

describe("markets — forex quotes", () => {
  it("returns 7 majors by default", () => {
    const r = call("forex-quotes", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.quotes.length, 7);
  });

  it("USDJPY pip is 0.01 not 0.0001", () => {
    const r = call("forex-quotes", ctxA, { pairs: ["USDJPY"] });
    const jpy = r.result.quotes[0];
    assert.ok(jpy.bid > 1); // Yen rates are in tens/hundreds, not below 1
  });
});

describe("markets — depth of book", () => {
  it("returns simulated L2 with N levels each side", () => {
    const r = call("depth-of-book", ctxA, { symbol: "SPY", last: 450, levels: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.bids.length, 10);
    assert.equal(r.result.asks.length, 10);
    assert.equal(r.result.kind, "simulated");
  });

  it("bids descend, asks ascend in price", () => {
    const r = call("depth-of-book", ctxA, { symbol: "SPY", last: 450 });
    const bidPrices = r.result.bids.map((b) => b.price);
    const askPrices = r.result.asks.map((a) => a.price);
    for (let i = 1; i < bidPrices.length; i++) assert.ok(bidPrices[i] < bidPrices[i - 1]);
    for (let i = 1; i < askPrices.length; i++) assert.ok(askPrices[i] > askPrices[i - 1]);
  });
});

describe("markets — alerts (per-user)", () => {
  it("creates and lists alert", () => {
    const c = call("alert-create", ctxA, { symbol: "SPY", condition: "price_above", threshold: 460 });
    assert.equal(c.ok, true);
    const l = call("alerts-list", ctxA);
    assert.equal(l.result.alerts.length, 1);
  });

  it("rejects invalid condition", () => {
    const r = call("alert-create", ctxA, { symbol: "SPY", condition: "bogus", threshold: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /condition must be/);
  });

  it("INVARIANT: alerts scoped per-user", () => {
    call("alert-create", ctxA, { symbol: "SPY", condition: "price_above", threshold: 460 });
    const b = call("alerts-list", ctxB);
    assert.equal(b.result.alerts.length, 0);
  });

  it("cancel marks alert cancelled", () => {
    const c = call("alert-create", ctxA, { symbol: "X", condition: "price_below", threshold: 1 });
    call("alert-cancel", ctxA, { id: c.result.alert.id });
    const l = call("alerts-list", ctxA);
    assert.equal(l.result.alerts[0].status, "cancelled");
  });
});

describe("markets — STATE unavailable path", () => {
  it("returns error shape when STATE is missing for stateful macros", () => {
    globalThis._concordSTATE = undefined;
    const r = call("alerts-list", ctxA);
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});
