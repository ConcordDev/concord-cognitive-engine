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

// ── Competitive-intelligence parity backlog (Crayon / Klue) ───────────
describe("market.competitor-news (Google News RSS)", () => {
  it("returns empty with note when no tracked competitors and no query", async () => {
    const r = await call("competitor-news", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.items.length, 0);
    assert.match(r.result.note, /No tracked competitors/);
  });

  it("parses RSS items and tags tracked competitors in headlines", async () => {
    call("competitor-add", ctxA, { name: "Acme Corp", segment: "saas" });
    globalThis.fetch = async (url) => {
      assert.match(url, /news\.google\.com\/rss\/search/);
      return {
        ok: true,
        text: async () => `<rss><channel>
          <item><title>Acme Corp launches new product</title><link>https://x.test/1</link><pubDate>Mon, 01 Jan 2026</pubDate><source>TechNews</source></item>
          <item><title>Unrelated market story</title><link>https://x.test/2</link><pubDate>Tue, 02 Jan 2026</pubDate><source>Wire</source></item>
        </channel></rss>`,
      };
    };
    const r = await call("competitor-news", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.items.length, 2);
    assert.equal(r.result.taggedCount, 1);
    assert.equal(r.result.items[0].competitors[0].name, "Acme Corp");
    assert.equal(r.result.source, "google-news-rss");
  });

  it("returns error when news feed unreachable", async () => {
    const r = await call("competitor-news", ctxA, { query: "anything" });
    assert.equal(r.ok, false);
    assert.match(r.error, /news feed unreachable/);
  });
});

describe("market battlecards", () => {
  it("creates, updates, lists, and deletes a battlecard", () => {
    const c = call("battlecard-save", ctxA, {
      competitorName: "Acme",
      overview: "incumbent",
      whyWeWin: ["price", "speed"],
      whyWeLose: "support",
      objections: ["they say slow\nwe rebut"],
    });
    assert.equal(c.ok, true);
    assert.equal(c.result.updated, false);
    assert.equal(c.result.battlecard.whyWeWin.length, 2);

    const upd = call("battlecard-save", ctxA, { competitorName: "Acme", overview: "updated" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.updated, true);

    const list = call("battlecard-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);

    const del = call("battlecard-delete", ctxA, { id: c.result.battlecard.id });
    assert.equal(del.ok, true);
    assert.equal(call("battlecard-list", ctxA, {}).result.count, 0);
  });

  it("rejects battlecard with no competitor name", () => {
    const r = call("battlecard-save", ctxA, { overview: "x" });
    assert.equal(r.ok, false);
  });
});

describe("market win/loss analysis", () => {
  it("records deals and aggregates win-rate + reasons + competitor records", () => {
    assert.equal(call("winloss-record", ctxA, { dealName: "D1", outcome: "won", competitor: "Acme", reason: "price", dealValue: 1000 }).ok, true);
    assert.equal(call("winloss-record", ctxA, { dealName: "D2", outcome: "lost", competitor: "Acme", reason: "features", dealValue: 500 }).ok, true);
    assert.equal(call("winloss-record", ctxA, { dealName: "D3", outcome: "lost", competitor: "Beta", reason: "price", dealValue: 800 }).ok, true);

    const a = call("winloss-analysis", ctxA, {});
    assert.equal(a.ok, true);
    assert.equal(a.result.totalDeals, 3);
    assert.equal(a.result.won, 1);
    assert.equal(a.result.lost, 2);
    assert.equal(a.result.winRate, 33.3);
    assert.equal(a.result.wonValue, 1000);
    assert.ok(a.result.lossReasons.length > 0);
    assert.ok(a.result.competitorRecords.find((c) => c.competitor === "Acme"));
  });

  it("rejects deal with invalid outcome", () => {
    const r = call("winloss-record", ctxA, { dealName: "X", outcome: "maybe" });
    assert.equal(r.ok, false);
  });

  it("deletes a recorded deal", () => {
    const rec = call("winloss-record", ctxA, { dealName: "DD", outcome: "won" });
    const del = call("winloss-delete", ctxA, { id: rec.result.deal.id });
    assert.equal(del.ok, true);
  });
});

describe("market website-change tracking + change alerts", () => {
  it("snapshots a page, diffs on re-snapshot, and raises a change alert", async () => {
    let body = "<html><head><title>Pricing</title></head><body>Plan A $10 per month</body></html>";
    globalThis.fetch = async () => ({ ok: true, text: async () => body });
    const first = await call("page-snapshot", ctxA, { url: "https://comp.test/pricing", label: "Comp Pricing" });
    assert.equal(first.ok, true);
    assert.equal(first.result.diff, null);

    body = "<html><head><title>Pricing</title></head><body>Plan A $12 per month and more text</body></html>";
    const second = await call("page-snapshot", ctxA, { url: "https://comp.test/pricing" });
    assert.equal(second.ok, true);
    assert.equal(second.result.diff.changed, true);

    const watches = call("page-watch-list", ctxA, {});
    assert.equal(watches.ok, true);
    assert.equal(watches.result.count, 1);

    const alerts = call("change-alerts", ctxA, {});
    assert.equal(alerts.ok, true);
    assert.equal(alerts.result.count, 1);
    assert.equal(alerts.result.unread, 1);

    const mark = call("alert-mark-read", ctxA, { all: true });
    assert.equal(mark.ok, true);
    assert.equal(call("change-alerts", ctxA, {}).result.unread, 0);

    const del = call("page-watch-delete", ctxA, { id: watches.result.watches[0].id });
    assert.equal(del.ok, true);
  });

  it("returns error when page unreachable", async () => {
    const r = await call("page-snapshot", ctxA, { url: "https://x.test" });
    assert.equal(r.ok, false);
    assert.match(r.error, /page unreachable/);
  });
});

describe("market sizing — TAM/SAM/SOM", () => {
  it("computes top-down TAM/SAM/SOM", () => {
    const r = call("market-sizing", ctxA, { method: "top-down", tam: 1000000, serviceablePct: 30, marketSharePct: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.tam, 1000000);
    assert.equal(r.result.sam, 300000);
    assert.equal(r.result.som, 30000);
  });

  it("computes bottom-up TAM from customers x ARPC", () => {
    const r = call("market-sizing", ctxA, { method: "bottom-up", potentialCustomers: 5000, avgRevenuePerCustomer: 200, serviceablePct: 50, marketSharePct: 20 });
    assert.equal(r.ok, true);
    assert.equal(r.result.tam, 1000000);
    assert.equal(r.result.sam, 500000);
    assert.equal(r.result.som, 100000);
  });

  it("saves and lists named sizing scenarios", () => {
    const r = call("market-sizing", ctxA, { method: "top-down", tam: 500000, save: true, label: "Base case" });
    assert.equal(r.ok, true);
    assert.equal(r.result.saved, true);
    const list = call("sizing-scenarios", ctxA, {});
    assert.equal(list.ok, true);
    assert.ok(list.result.scenarios.find((s) => s.label === "Base case"));
  });
});

describe("market landscape quadrant", () => {
  it("returns a note when no competitors are tracked", () => {
    const r = call("landscape-quadrant", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(r.result.note, /No competitors tracked/);
  });

  it("plots tracked competitors into 2x2 quadrants from real records", () => {
    call("competitor-add", ctxA, { name: "Big", marketSharePct: 40, threatLevel: "high", strengths: "scale, brand", weaknesses: "slow" });
    call("competitor-add", ctxA, { name: "Small", marketSharePct: 5, threatLevel: "low", strengths: "agile", weaknesses: "no brand, no support, thin team" });
    const r = call("landscape-quadrant", ctxA, { xAxis: "share", yAxis: "strength" });
    assert.equal(r.ok, true);
    assert.equal(r.result.points.length, 2);
    assert.ok(r.result.leader);
    assert.equal(r.result.xAxis.axis, "Market Share");
    const total = Object.values(r.result.quadrants).reduce((n, arr) => n + arr.length, 0);
    assert.equal(total, 2);
  });
});
