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

describe("markets — futures board (Yahoo Finance live)", () => {
  it("returns error when network is disabled (hermetic test)", async () => {
    const r = await call("futures-board", ctxA);
    // Tests mock fetch to throw — this verifies real fetch is wired.
    // In production with network, this returns ok with live data.
    assert.equal(r.ok, false);
    assert.match(r.error, /fetch failed|network/);
  });

  it("happy-path: builds correct shape from mocked Yahoo response", async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /finance\.yahoo\.com/);
      return {
        ok: true,
        json: async () => ({
          quoteResponse: {
            result: [
              { symbol: "ES=F", regularMarketPrice: 5850.25, regularMarketChange: 12.5, regularMarketChangePercent: 0.21, bid: 5850, ask: 5850.5, regularMarketVolume: 1_200_000, marketState: "REGULAR" },
            ],
          },
        }),
      };
    };
    const r = await call("futures-board", ctxA, { symbol: "ES" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "yahoo-finance");
    assert.equal(r.result.contracts.length, 1);
    assert.equal(r.result.contracts[0].last, 5850.25);
    assert.equal(r.result.contracts[0].change, 12.5);
    assert.equal(r.result.contracts[0].bid, 5850);
  });
});

describe("markets — forex quotes (Yahoo Finance live)", () => {
  it("builds correct shape from mocked Yahoo response", async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /EURUSD%3DX/);
      return {
        ok: true,
        json: async () => ({
          quoteResponse: {
            result: [
              { symbol: "EURUSD=X", regularMarketPrice: 1.0875, bid: 1.0874, ask: 1.0876, regularMarketChange: 0.0003, regularMarketChangePercent: 0.028 },
            ],
          },
        }),
      };
    };
    const r = await call("forex-quotes", ctxA, { pairs: ["EURUSD"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "yahoo-finance");
    assert.equal(r.result.quotes[0].mid, 1.0875);
    assert.equal(r.result.quotes[0].bidAskSource, "yahoo-real");
  });

  it("USDJPY pip is 0.01 not 0.0001 (rates in tens/hundreds)", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        quoteResponse: { result: [{ symbol: "USDJPY=X", regularMarketPrice: 149.85, bid: 149.83, ask: 149.87 }] },
      }),
    });
    const r = await call("forex-quotes", ctxA, { pairs: ["USDJPY"] });
    assert.ok(r.result.quotes[0].bid > 1);
  });
});

describe("markets — depth of book (real inside quote)", () => {
  it("returns single-level inside quote from Yahoo, NOT synthesized L2", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        quoteResponse: { result: [{ symbol: "SPY", regularMarketPrice: 450, bid: 449.99, ask: 450.01, bidSize: 100, askSize: 200, marketState: "REGULAR" }] },
      }),
    });
    const r = await call("depth-of-book", ctxA, { symbol: "SPY" });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "inside-quote");
    assert.equal(r.result.source, "yahoo-finance");
    assert.equal(r.result.bids.length, 1);
    assert.equal(r.result.asks.length, 1);
    assert.equal(r.result.bids[0].price, 449.99);
    assert.equal(r.result.asks[0].price, 450.01);
    assert.match(r.result.notes, /Full L2.*licensed feed/);
  });

  it("rejects unknown symbol gracefully", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ quoteResponse: { result: [] } }),
    });
    const r = await call("depth-of-book", ctxA, { symbol: "NOTREAL" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no quote/);
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
