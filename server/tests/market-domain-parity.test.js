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
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

function mockYahoo(quotesByYahooSymbol) {
  globalThis.fetch = async (url) => {
    assert.match(url, /query1\.finance\.yahoo\.com\/v7\/finance\/quote/);
    const m = /symbols=([^&]+)/.exec(url);
    const symbols = m ? decodeURIComponent(m[1]).split(",") : [];
    return {
      ok: true,
      json: async () => ({
        quoteResponse: {
          result: symbols
            .map((s) => quotesByYahooSymbol[s])
            .filter(Boolean),
        },
      }),
    };
  };
}

describe("market parity macros (real Yahoo Finance feeds)", () => {
  it("sector-performance returns 11 sectors from SPDR ETF feed", async () => {
    mockYahoo({
      XLK: { symbol: "XLK", regularMarketPrice: 220, regularMarketChangePercent: 0.8, marketCap: 70_000_000_000 },
      XLV: { symbol: "XLV", regularMarketPrice: 145, regularMarketChangePercent: -0.3, marketCap: 40_000_000_000 },
      XLF: { symbol: "XLF", regularMarketPrice: 42, regularMarketChangePercent: 0.4, marketCap: 50_000_000_000 },
      XLY: { symbol: "XLY", regularMarketPrice: 200, regularMarketChangePercent: 1.2, marketCap: 22_000_000_000 },
      XLC: { symbol: "XLC", regularMarketPrice: 80, regularMarketChangePercent: 0.9, marketCap: 18_000_000_000 },
      XLI: { symbol: "XLI", regularMarketPrice: 130, regularMarketChangePercent: 0.2, marketCap: 17_000_000_000 },
      XLP: { symbol: "XLP", regularMarketPrice: 79, regularMarketChangePercent: -0.1, marketCap: 15_000_000_000 },
      XLE: { symbol: "XLE", regularMarketPrice: 92, regularMarketChangePercent: 1.5, marketCap: 38_000_000_000 },
      XLU: { symbol: "XLU", regularMarketPrice: 73, regularMarketChangePercent: -0.6, marketCap: 14_000_000_000 },
      XLB: { symbol: "XLB", regularMarketPrice: 89, regularMarketChangePercent: 0.3, marketCap: 7_000_000_000 },
      XLRE: { symbol: "XLRE", regularMarketPrice: 40, regularMarketChangePercent: -0.2, marketCap: 8_000_000_000 },
    });
    const r = await call("sector-performance", ctxA, { range: "1D" });
    assert.equal(r.ok, true);
    assert.equal(r.result.sectors.length, 11);
    assert.equal(r.result.source, "yahoo-finance");
    for (const s of r.result.sectors) {
      assert.ok(typeof s.pct === "number");
      assert.ok(s.marketCap > 0);
      assert.ok(s.etf);
    }
  });

  it("sector-performance returns error when Yahoo unreachable", async () => {
    const r = await call("sector-performance", ctxA, { range: "1D" });
    assert.equal(r.ok, false);
    assert.match(r.error, /yahoo finance unreachable/);
  });

  it("sector-performance 1W returns pct:null with informational note (window not on quote endpoint)", async () => {
    mockYahoo({ XLK: { symbol: "XLK", regularMarketPrice: 220, regularMarketChangePercent: 0.8, marketCap: 70_000_000_000 } });
    const r = await call("sector-performance", ctxA, { range: "1W" });
    assert.equal(r.ok, true);
    assert.equal(r.result.sectors[0].pct, null);
    assert.match(r.result.notes, /not available on quote endpoint/);
  });

  it("quotes-batch returns N quotes from real Yahoo response", async () => {
    mockYahoo({
      AAPL: { symbol: "AAPL", longName: "Apple Inc.", regularMarketPrice: 195.5, regularMarketChangePercent: 0.4, fiftyTwoWeekChangePercent: 18, regularMarketVolume: 50_000_000, marketCap: 3_050_000_000_000, trailingPE: 30, epsTrailingTwelveMonths: 6.5 },
      MSFT: { symbol: "MSFT", longName: "Microsoft Corp.", regularMarketPrice: 425, regularMarketChangePercent: -0.2, fiftyTwoWeekChangePercent: 22, regularMarketVolume: 22_000_000, marketCap: 3_200_000_000_000, trailingPE: 35, epsTrailingTwelveMonths: 12.1 },
      TSLA: { symbol: "TSLA", longName: "Tesla Inc.", regularMarketPrice: 245, regularMarketChangePercent: 1.1, fiftyTwoWeekChangePercent: -5, regularMarketVolume: 90_000_000, marketCap: 770_000_000_000, trailingPE: 65, epsTrailingTwelveMonths: 3.77 },
    });
    const r = await call("quotes-batch", ctxA, { symbols: ["AAPL", "MSFT", "TSLA"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.quotes.length, 3);
    assert.equal(r.result.quotes[0].symbol, "AAPL");
    assert.equal(r.result.quotes[0].name, "Apple Inc.");
    for (const q of r.result.quotes) {
      assert.ok(q.price > 0);
      assert.ok(q.marketCap > 0);
    }
  });

  it("quotes-batch returns error when Yahoo unreachable", async () => {
    const r = await call("quotes-batch", ctxA, { symbols: ["AAPL"] });
    assert.equal(r.ok, false);
    assert.match(r.error, /yahoo finance unreachable/);
  });

  it("quotes-batch handles empty input without network call", async () => {
    const r = await call("quotes-batch", ctxA, { symbols: [] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.quotes, []);
  });

  it("quotes-batch flags unknown symbols rather than synthesizing", async () => {
    mockYahoo({});
    const r = await call("quotes-batch", ctxA, { symbols: ["FAKE123"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.quotes[0].symbol, "FAKE123");
    assert.equal(r.result.quotes[0].error, "no quote available");
  });
});
