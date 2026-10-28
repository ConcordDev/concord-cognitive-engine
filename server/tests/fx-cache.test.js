// FX on the shared feed-cache: finance.feed (Frankfurter / ECB) and accounting.currency-refresh-rates
// (open.er-api.com) read lib/market-feed-sources.js, so many callers cost one upstream request per TTL.
// No network: fetchPublicUrl's module test transport is replaced, and the global fetch throws.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { configureFeedCache, stats } from "../lib/feed-cache.js";
import {
  getFrankfurterLatest, getErApiLatest, ERAPI_ATTRIBUTION, _resetMarketFeedForTests,
} from "../lib/market-feed-sources.js";

const realFetch = globalThis.fetch;
const HOUR = 60 * 60_000;
const res = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
const ECB = { amount: 1, base: "USD", date: "2026-10-27", rates: { EUR: 0.92, GBP: 0.79, JPY: 150.5 } };
const ER = { result: "success", base_code: "USD", time_last_update_utc: "Tue, 27 Oct 2026 00:00:01 +0000", rates: { USD: 1, EUR: 0.92, GBP: 0.79 } };

let calls;
let clock;
let route;

beforeEach(() => {
  calls = [];
  clock = 1_000_000_000;
  route = (url) => (url.includes("frankfurter") ? res(ECB) : res(ER));
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

async function domain(file) {
  const actions = new Map();
  (await import(`../domains/${file}.js`)).default((d, n, fn) => actions.set(`${d}.${n}`, fn));
  return actions;
}

test("finance.feed keeps its DTU source + public fields, and a second run is a cache hit", async () => {
  const feed = (await domain("finance")).get("finance.feed");
  const created = [];
  const ctx = { macro: { run: async (_d, _n, input) => { created.push(input); return { ok: true, dtu: { id: `dtu_${created.length}` } }; } } };
  const a = await feed(ctx, null, { limit: 12 });
  assert.equal(a.ok, true);
  assert.equal(a.result.ingested, 3);
  assert.equal(a.result.source, "ecb-fx-rates");
  assert.equal(created.length, 3);
  for (const c of created) {
    assert.equal(c.source, "frankfurter-feed");
    assert.equal(c.visibility, "public");
    assert.equal(c.visibilityScope, "global");
    assert.deepEqual(c.tags, ["finance", "feed", "forex", "ecb"]);
    assert.equal(c.meta.base, "USD");
    assert.equal(c.meta.date, "2026-10-27");
  }
  const b = await feed(ctx, null, { limit: 12 });
  assert.equal(b.result.ingested, 0);
  assert.equal(b.result.skipped, 3);
  assert.equal(calls.length, 1, "ECB rates are cached for an hour");
  assert.equal(calls[0].url, "https://api.frankfurter.dev/v1/latest?from=USD");
});

test("finance.feed: upstream down is an honest error, nothing is ingested", async () => {
  const feed = (await domain("finance")).get("finance.feed");
  route = () => res({}, 503);
  const created = [];
  const r = await feed({ macro: { run: async (...a) => { created.push(a); return { ok: true, dtu: { id: "x" } }; } } }, null, {});
  assert.equal(r.ok, false);
  assert.match(r.error, /frankfurter/);
  assert.equal(created.length, 0);
});

test("Frankfurter key sorts/validates symbols; ttl 1 h, stale up to 2 d", async () => {
  await getFrankfurterLatest({ base: "usd", symbols: ["gbp", "eur"] });
  await getFrankfurterLatest({ base: "USD", symbols: ["EUR", "GBP", "eur"] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.frankfurter.dev/v1/latest?from=USD&to=EUR,GBP");
  const bad = await getFrankfurterLatest({ base: "US", symbols: [] });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "invalid_currency");

  clock += HOUR + 1000;
  route = () => res({}, 503); // ECB unreachable after the TTL: serve the last real rates, labelled stale
  const stale = await getFrankfurterLatest({ base: "USD", symbols: ["EUR", "GBP"] });
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(typeof stale.fetchedAt, "number");
  assert.deepEqual(stale.data, ECB);
  assert.equal(stats()["fx-frankfurter"].license, "public");
});

test("accounting.currency-refresh-rates: two users share one ER-API call and the result carries the attribution", async () => {
  const refresh = (await domain("accounting")).get("accounting.currency-refresh-rates");
  const a = await refresh({ userId: "user_a" }, null, { symbols: ["EUR", "GBP"] });
  const b = await refresh({ userId: "user_b" }, null, {});
  assert.equal(a.ok, true);
  assert.equal(a.result.updated, 2);
  assert.equal(a.result.asOf, ER.time_last_update_utc);
  assert.equal(a.result.attribution, ERAPI_ATTRIBUTION);
  assert.equal(a.result.attributionUrl, "https://www.exchangerate-api.com");
  assert.equal(a.result.stale, undefined);
  assert.equal(b.ok, true);
  assert.equal(calls.length, 1, "6 h TTL, keyed by base: one call for both users");
  assert.equal(calls[0].url, "https://open.er-api.com/v6/latest/USD");
});

test("accounting.currency-refresh-rates: outage is honest (unavailable + reason), never invented rates", async () => {
  const refresh = (await domain("accounting")).get("accounting.currency-refresh-rates");
  route = () => res({}, 500);
  const r = await refresh({ userId: "user_a" }, null, {});
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  assert.match(r.error, /FX rate fetch failed/);
  assert.equal(r.result, undefined);
});

test("ER-API: 6 h TTL; after it, upstream down serves labelled stale rates", async () => {
  const first = await getErApiLatest("usd");
  assert.equal(first.ok, true);
  clock += 5 * HOUR;
  await getErApiLatest("USD");
  assert.equal(calls.length, 1);
  clock += 2 * HOUR; // 7 h > ttl
  route = () => res({}, 503);
  const stale = await getErApiLatest("USD");
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  clock += 4 * 24 * HOUR; // beyond the 3 d stale limit
  const gone = await getErApiLatest("USD");
  assert.equal(gone.ok, false);
  assert.equal(gone.status, "unavailable");
});
