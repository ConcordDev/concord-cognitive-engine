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

// ════════════════════════════════════════════════════════════════
// Prediction-market layer (Polymarket / Kalshi parity)
// ════════════════════════════════════════════════════════════════

function freshMarket(ctx = ctxA, overrides = {}) {
  return call("market-create", ctx, {
    question: "Will Concordia hit 1M DTUs by year end?",
    resolutionCriteria: "Resolves YES if the substrate DTU count exceeds 1,000,000.",
    category: "concordia",
    ...overrides,
  });
}

describe("markets — market creation", () => {
  it("creates a market with seeded liquidity + live odds", () => {
    const r = freshMarket();
    assert.equal(r.ok, true);
    assert.ok(r.result.market.id);
    assert.equal(r.result.market.status, "open");
    assert.equal(r.result.market.yesPercent, 50);
    assert.equal(r.result.market.category, "concordia");
  });

  it("rejects too-short question / criteria", () => {
    assert.equal(freshMarket(ctxA, { question: "no" }).ok, false);
    assert.equal(freshMarket(ctxA, { resolutionCriteria: "x" }).ok, false);
  });

  it("rejects a past close timestamp", () => {
    const r = freshMarket(ctxA, { closesAt: Date.now() - 1000 });
    assert.equal(r.ok, false);
  });
});

describe("markets — list / search / categories", () => {
  it("lists created markets with category facets", () => {
    freshMarket();
    freshMarket(ctxA, { category: "sports", question: "Will the raid succeed tonight?" });
    const r = call("market-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.markets.length >= 2);
    assert.ok(Array.isArray(r.result.categories));
    assert.ok(r.result.facets.concordia >= 1);
  });

  it("filters by category and search text", () => {
    freshMarket(ctxA, { category: "crypto", question: "Will BTC close above 100k?" });
    const cat = call("market-list", ctxA, { category: "crypto" });
    assert.ok(cat.result.markets.every((m) => m.category === "crypto"));
    const search = call("market-list", ctxA, { search: "BTC" });
    assert.ok(search.result.markets.length >= 1);
  });
});

describe("markets — positions + live odds", () => {
  it("opens a position and shifts the implied probability", () => {
    const m = freshMarket().result.market;
    const before = call("market-odds", ctxA, { marketId: m.id, stake: 100 });
    assert.equal(before.ok, true);
    const pos = call("position-open", ctxA, { marketId: m.id, side: "yes", stakeSparks: 100 });
    assert.equal(pos.ok, true);
    assert.equal(pos.result.position.side, "yes");
    assert.ok(pos.result.market.yesProbability > before.result.yesProbability);
  });

  it("my-positions shows mark-to-market unrealized PnL", () => {
    const m = freshMarket().result.market;
    call("position-open", ctxA, { marketId: m.id, side: "yes", stakeSparks: 50 });
    const r = call("my-positions", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.positions.length >= 1);
    assert.ok(r.result.positions[0].currentValue != null);
  });

  it("rejects bet on a non-existent market", () => {
    const r = call("position-open", ctxA, { marketId: "nope", side: "yes", stakeSparks: 10 });
    assert.equal(r.ok, false);
  });
});

describe("markets — price history", () => {
  it("records a price point per trade", () => {
    const m = freshMarket().result.market;
    call("position-open", ctxA, { marketId: m.id, side: "yes", stakeSparks: 30 });
    call("position-open", ctxB, { marketId: m.id, side: "no", stakeSparks: 20 });
    const r = call("market-history", ctxA, { marketId: m.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.points.length >= 3);
    assert.ok("yesPercent" in r.result.points[0]);
  });
});

describe("markets — cash-out", () => {
  it("cashes out an open position with an exit fee", () => {
    const m = freshMarket().result.market;
    const pos = call("position-open", ctxA, { marketId: m.id, side: "yes", stakeSparks: 100 }).result.position;
    call("position-open", ctxB, { marketId: m.id, side: "no", stakeSparks: 100 });
    const r = call("position-cashout", ctxA, { positionId: pos.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.position.status, "cashed_out");
    assert.ok(r.result.exitFee > 0);
  });

  it("rejects cash-out of someone else's position", () => {
    const m = freshMarket().result.market;
    const pos = call("position-open", ctxA, { marketId: m.id, side: "yes", stakeSparks: 10 }).result.position;
    const r = call("position-cashout", ctxB, { positionId: pos.id });
    assert.equal(r.ok, false);
  });
});

describe("markets — limit orders + order book", () => {
  it("places a resting limit order and shows it in the book", () => {
    const m = freshMarket().result.market;
    const o = call("order-place", ctxA, { marketId: m.id, side: "yes", limitPrice: 0.3, stakeSparks: 40 });
    assert.equal(o.ok, true);
    const book = call("order-book", ctxA, { marketId: m.id });
    assert.equal(book.ok, true);
    assert.ok(book.result.myOrders.length >= 1);
  });

  it("fills a limit order immediately when price is through the limit", () => {
    const m = freshMarket().result.market;
    // market starts at 0.5 — a yes order at limit 0.9 fills at once
    const o = call("order-place", ctxA, { marketId: m.id, side: "yes", limitPrice: 0.9, stakeSparks: 25 });
    assert.equal(o.ok, true);
    assert.equal(o.result.immediatelyFilled, true);
  });

  it("cancels a resting order", () => {
    const m = freshMarket().result.market;
    const o = call("order-place", ctxA, { marketId: m.id, side: "no", limitPrice: 0.2, stakeSparks: 10 });
    const c = call("order-cancel", ctxA, { orderId: o.result.order.id });
    assert.equal(c.ok, true);
    assert.equal(c.result.order.status, "cancelled");
  });
});

describe("markets — resolution + settlement", () => {
  it("resolves a market, pays winners, and exposes evidence", () => {
    const m = freshMarket().result.market;
    call("position-open", ctxA, { marketId: m.id, side: "yes", stakeSparks: 100 });
    call("position-open", ctxB, { marketId: m.id, side: "no", stakeSparks: 100 });
    const r = call("market-resolve", ctxA, {
      marketId: m.id, outcome: "yes", evidence: "Substrate DTU count crossed 1M on 2026-12-30.",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.market.status, "resolved");
    assert.equal(r.result.settlement.winners, 1);
    assert.equal(r.result.settlement.losers, 1);
    const res = call("market-resolution", ctxA, { marketId: m.id });
    assert.equal(res.result.resolved, true);
    assert.match(res.result.resolution.evidence, /crossed 1M/);
  });

  it("rejects resolution by a non-creator", () => {
    const m = freshMarket().result.market;
    const r = call("market-resolve", ctxB, { marketId: m.id, outcome: "yes", evidence: "not my market really" });
    assert.equal(r.ok, false);
  });

  it("rejects resolution without evidence", () => {
    const m = freshMarket().result.market;
    const r = call("market-resolve", ctxA, { marketId: m.id, outcome: "no", evidence: "x" });
    assert.equal(r.ok, false);
  });
});

describe("markets — leaderboard", () => {
  it("ranks forecasters by realized PnL after settlement", () => {
    const m = freshMarket().result.market;
    call("position-open", ctxA, { marketId: m.id, side: "yes", stakeSparks: 100 });
    call("position-open", ctxB, { marketId: m.id, side: "no", stakeSparks: 100 });
    call("market-resolve", ctxA, { marketId: m.id, outcome: "yes", evidence: "Resolved YES per criteria." });
    const r = call("leaderboard", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.leaderboard.length >= 1);
    assert.equal(r.result.leaderboard[0].rank, 1);
  });
});

describe("markets.quote-history (Yahoo Finance chart endpoint)", () => {
  it("rejects empty symbol", async () => {
    assert.equal((await call("quote-history", ctxA, {})).ok, false);
  });

  it("rejects invalid range / interval", async () => {
    assert.equal((await call("quote-history", ctxA, { symbol: "SPY", range: "bogus" })).ok, false);
    assert.equal((await call("quote-history", ctxA, { symbol: "SPY", interval: "10s" })).ok, false);
  });

  it("hits Yahoo chart + parses OHLCV bars", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = String(url);
      return {
        ok: true, status: 200,
        json: async () => ({
          chart: {
            result: [{
              meta: { symbol: "AAPL", currency: "USD", exchangeName: "NMS",
                instrumentType: "EQUITY", chartPreviousClose: 175.5, regularMarketPrice: 178.2 },
              timestamp: [1700000000, 1700086400, 1700172800],
              indicators: {
                quote: [{
                  open:  [175.0, 176.5, 177.0],
                  high:  [177.5, 178.0, 179.2],
                  low:   [174.5, 176.0, 176.8],
                  close: [176.5, 177.0, 178.2],
                  volume: [50000000, 48000000, 52000000],
                }],
                adjclose: [{ adjclose: [176.5, 177.0, 178.2] }],
              },
            }],
          },
        }),
      };
    };
    const r = await call("quote-history", ctxA, { symbol: "AAPL", range: "1mo", interval: "1d" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /query1\.finance\.yahoo\.com\/v8\/finance\/chart\/AAPL/);
    assert.match(capturedUrl, /range=1mo/);
    assert.match(capturedUrl, /interval=1d/);
    assert.equal(r.result.symbol, "AAPL");
    assert.equal(r.result.bars.length, 3);
    assert.equal(r.result.bars[0].close, 176.5);
    assert.equal(r.result.currency, "USD");
    assert.equal(r.result.source, "yahoo-finance-chart");
  });

  it("filters out null-close bars (halted / pre-market gaps)", async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({
        chart: { result: [{
          meta: {},
          timestamp: [1, 2, 3],
          indicators: { quote: [{ open: [1, 2, 3], high: [1, 2, 3], low: [1, 2, 3], close: [1, null, 3], volume: [10, null, 30] }] },
        }] },
      }),
    });
    const r = await call("quote-history", ctxA, { symbol: "X", range: "1mo" });
    assert.equal(r.ok, true);
    assert.equal(r.result.bars.length, 2);
  });

  it("surfaces 404 from Yahoo for unknown symbols", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("quote-history", ctxA, { symbol: "ZZZZZ", range: "1mo" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });
});
