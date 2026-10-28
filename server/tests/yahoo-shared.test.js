// One Yahoo cache: markets.js, market.js and the realtime/feed-manager index pollers share the v7 quote
// and v8 chart entries in lib/market-feed-sources.js (feed-cache). No network: fetchPublicUrl's module test
// transport is replaced, and the global fetch throws so a surviving bare fetch() fails loudly.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { configureFeedCache, stats } from "../lib/feed-cache.js";
import {
  getYahooQuotes, getYahooChart, getMarketUpstream, yahooChartUrl, yahooQuoteKey, yahooChartKey,
  _resetMarketFeedForTests,
} from "../lib/market-feed-sources.js";

const realFetch = globalThis.fetch;
const res = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
const chartBody = (sym, price = 105) => ({
  chart: { result: [{
    meta: { symbol: sym, regularMarketPrice: price, previousClose: 100, chartPreviousClose: 100, currency: "USD", exchangeName: "NYSE" },
    timestamp: [1, 2], indicators: { quote: [{ open: [1, 2], high: [2, 3], low: [0, 1], close: [1.5, 2.5], volume: [10, 20] }] },
  }] },
});
const quoteBody = (symbols) => ({ quoteResponse: { result: symbols.map((symbol) => ({ symbol, regularMarketPrice: 50, regularMarketChange: 1, regularMarketChangePercent: 2 })) } });

let calls;
let clock;
let route;

const symbolsOf = (url) => decodeURIComponent(new URL(url).searchParams.get("symbols") || "").split(",");
const chartSymbolOf = (url) => decodeURIComponent(new URL(url).pathname.split("/").pop());

beforeEach(() => {
  calls = [];
  clock = 1_000_000_000;
  route = (url) => (url.includes("/v7/finance/quote") ? res(quoteBody(symbolsOf(url))) : res(chartBody(chartSymbolOf(url))));
  _resetMarketFeedForTests();
  configureFeedCache({ now: () => clock, sleep: async () => {}, log: () => {}, logUpstream: null });
  __setPublicFetchTestTransport(async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return route(String(url));
  });
  globalThis.fetch = () => { throw new Error("bare fetch() is forbidden in market paths"); };
});
afterEach(() => {
  __setPublicFetchTestTransport(null);
  globalThis.fetch = realFetch;
  _resetMarketFeedForTests();
});

async function domain(file) {
  const actions = new Map();
  (await import(`../domains/${file}.js`)).default((d, n, fn) => actions.set(`${d}.${n}`, fn));
  return actions;
}

test("quote keys are order- and case-insensitive; chart keys validate range/interval", () => {
  assert.equal(yahooQuoteKey(["gc=f", "ES=F", "es=f"]), "ES=F,GC=F");
  assert.equal(yahooQuoteKey([]), null);
  assert.equal(yahooQuoteKey(["bad symbol"]), null);
  assert.equal(yahooChartKey("^gspc", { range: "1d", interval: "1d" }), "^GSPC|1d|1d");
  assert.equal(yahooChartKey("SPY", { range: "7mo" }), null);
  assert.equal(yahooChartKey("SPY", { interval: "2h" }), null);
});

test("markets.futures-board twice -> ONE v7 call with the Mozilla UA", async () => {
  const markets = await domain("markets");
  const board = markets.get("markets.futures-board");
  const a = await board({}, null, {});
  const b = await board({}, null, {});
  assert.equal(a.ok, true);
  assert.equal(a.result.source, "yahoo-finance");
  assert.ok(a.result.contracts.length > 0);
  assert.deepEqual(b.result.contracts, a.result.contracts);
  assert.equal(calls.length, 1, "second board read is a cache hit");
  assert.match(calls[0].url, /^https:\/\/query1\.finance\.yahoo\.com\/v7\/finance\/quote\?symbols=/);
  assert.equal(calls[0].init.headers["User-Agent"], "Mozilla/5.0 (Concord-OS/1.0)");
});

test("markets.quote-history and the realtime index poller share one chart entry", async () => {
  const markets = await domain("markets");
  const hist = markets.get("markets.quote-history");
  const poll = await getMarketUpstream(yahooChartUrl("^GSPC")); // what realtime-feeds / feed-manager read
  const r = await hist({}, null, { symbol: "^gspc", range: "1d", interval: "1d" });
  assert.equal(poll.ok, true);
  assert.equal(r.ok, true);
  assert.equal(r.result.count, 2);
  assert.equal(r.result.stale, undefined);
  assert.equal(calls.length, 1, "poller and lens read the same cache entry");
  assert.equal(calls[0].url, yahooChartUrl("^GSPC"));
});

test("markets.quote-history: 404 is 'symbol not found'; an outage is an honest error, never made-up bars", async () => {
  const hist = (await domain("markets")).get("markets.quote-history");
  route = () => res({}, 404);
  const nf = await hist({}, null, { symbol: "NOPE" });
  assert.deepEqual(nf, { ok: false, error: "symbol not found: NOPE" });
  route = () => res({}, 503);
  const down = await hist({}, null, { symbol: "SPY" });
  assert.equal(down.ok, false);
  assert.match(down.error, /yahoo finance unreachable/);
  assert.equal(down.result, undefined);
});

test("markets.quote-history labels a stale chart (upstream down, inside the 1 h limit)", async () => {
  const hist = (await domain("markets")).get("markets.quote-history");
  await hist({}, null, { symbol: "SPY" });
  clock += 6 * 60_000; // past the 5 min TTL
  route = () => res({}, 503);
  const r = await hist({}, null, { symbol: "SPY" });
  assert.equal(r.ok, true);
  assert.equal(r.result.stale, true);
  assert.equal(typeof r.result.fetchedAt, "number");
});

test("market.quotes-batch: v7 401 is cached as a marker and falls back to the shared chart entries", async () => {
  const market = await domain("market");
  const batch = market.get("market.quotes-batch");
  route = (url) => (url.includes("/v7/finance/quote") ? res({}, 401) : res(chartBody(chartSymbolOf(url), 123)));
  const a = await batch({}, null, { symbols: ["aapl", "msft"] });
  assert.equal(a.ok, true);
  assert.equal(a.result.source, "yahoo-finance-chart");
  assert.deepEqual(a.result.quotes.map((q) => q.symbol), ["AAPL", "MSFT"]);
  assert.equal(a.result.quotes[0].price, 123);
  const first = calls.length; // 1 quote + 2 charts
  assert.equal(first, 3);
  const b = await batch({}, null, { symbols: ["msft", "aapl"] });
  assert.equal(b.ok, true);
  assert.equal(calls.length, first, "v7 401 marker + chart entries are all cache hits");
  assert.equal(calls.filter((c) => c.url.includes("/v7/")).length, 1, "v7 is not re-hit while it keeps answering 401");
});

test("market.quotes-batch: a quote outage is an honest error", async () => {
  const batch = (await domain("market")).get("market.quotes-batch");
  route = () => res({}, 503);
  const r = await batch({}, null, { symbols: ["AAPL"] });
  assert.equal(r.ok, false);
  assert.match(r.error, /yahoo finance unreachable/);
});

test("getYahooQuotes / getYahooChart report http status and never invent data", async () => {
  route = () => res({}, 403);
  const q = await getYahooQuotes(["SPY"]);
  assert.equal(q.ok, false);
  assert.equal(q.status, "unavailable");
  assert.equal(q.reason, "http_403");
  assert.equal(q.httpStatus, 403);
  route = () => res({}, 500);
  const c = await getYahooChart("SPY", { range: "5d", interval: "1d" });
  assert.equal(c.ok, false);
  assert.equal(c.data, undefined);
  assert.equal(stats()["yahoo-quote"].license, "internal-only");
});
