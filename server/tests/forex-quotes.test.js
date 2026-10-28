// markets.forex-quotes runs on the ECB reference rates via Frankfurter
// (feed-cache source fx-frankfurter) — Yahoo v7 answers 401 unauthenticated.
// Mids are derived from ONE USD-based fetch; bid/ask/spread/change are null
// because the ECB publishes reference mids only and no spread is invented.
// No network: the public-fetch test transport is injected.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { configureFeedCache } from "../lib/feed-cache.js";
import { _resetMarketFeedForTests, FRANKFURTER_ATTRIBUTION, FRANKFURTER_ATTRIBUTION_URL } from "../lib/market-feed-sources.js";

const realFetch = globalThis.fetch;
const res = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
const ECB = {
  amount: 1, base: "USD", date: "2026-10-27",
  rates: { EUR: 0.92, GBP: 0.79, JPY: 150.5, CHF: 0.88, CAD: 1.36, AUD: 1.52, NZD: 1.67 },
};

let calls;
let clock;
let route;

beforeEach(() => {
  calls = [];
  clock = 1_000_000_000;
  route = () => res(ECB);
  _resetMarketFeedForTests();
  configureFeedCache({ now: () => clock, sleep: async () => {}, log: () => {}, logUpstream: null });
  __setPublicFetchTestTransport(async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return route(String(url));
  });
  globalThis.fetch = () => { throw new Error("bare fetch() is forbidden in FX paths"); };
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});
afterEach(() => {
  __setPublicFetchTestTransport(null);
  globalThis.fetch = realFetch;
  delete globalThis._concordSTATE;
  delete globalThis._concordSaveStateDebounced;
  _resetMarketFeedForTests();
});

async function forexQuotes(params = {}) {
  const actions = new Map();
  (await import("../domains/markets.js")).default((d, n, fn) => actions.set(`${d}.${n}`, fn));
  return actions.get("markets.forex-quotes")({}, null, params);
}

test("forex-quotes returns ECB mids from one Frankfurter fetch, with null bid/ask/spread", async () => {
  const r = await forexQuotes();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.source, "ecb-frankfurter");
  assert.equal(r.result.asOf, "2026-10-27");
  assert.deepEqual(r.result.attribution, { text: FRANKFURTER_ATTRIBUTION, url: FRANKFURTER_ATTRIBUTION_URL });
  assert.equal(r.result.count, 7);
  const byPair = new Map(r.result.quotes.map((q) => [q.pair, q]));
  assert.equal(byPair.get("EURUSD").mid, 1.08696);   // 1 / 0.92
  assert.equal(byPair.get("GBPUSD").mid, 1.26582);   // 1 / 0.79
  assert.equal(byPair.get("USDJPY").mid, 150.5);
  assert.equal(byPair.get("USDCAD").mid, 1.36);
  assert.equal(byPair.get("AUDUSD").mid, 0.65789);   // 1 / 1.52
  for (const q of r.result.quotes) {
    assert.equal(q.bid, null);
    assert.equal(q.ask, null);
    assert.equal(q.spread, null);
    assert.equal(q.spreadPips, null);
    assert.equal(q.change, null);
    assert.equal(q.bidAskSource, "unavailable");
    assert.ok(q.pipValue > 0);
  }
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith("https://api.frankfurter.dev/v1/latest?"), calls[0].url);
  assert.ok(!calls.some((c) => c.url.includes("yahoo") || c.url.includes("=X")), "no Yahoo =X symbol is fetched");
});

test("a second forex-quotes call is a feed-cache hit (still 1 upstream call)", async () => {
  await forexQuotes();
  const r = await forexQuotes();
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
});

test("an upstream outage is the honest unavailable, never invented quotes", async () => {
  route = () => res({}, 503);
  const r = await forexQuotes();
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  assert.ok("reason" in r);
  assert.ok("lastOkAt" in r);
});
