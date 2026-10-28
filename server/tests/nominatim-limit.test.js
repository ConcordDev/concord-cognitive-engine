// Nominatim usage policy, enforced app-wide by lib/geo-feed-sources.js:
// 1 req/s queue, one upstream call per distinct query, identifying UA,
// switchable base, bounded wait. No network: fetchPublicUrl's test transport
// and the feed-cache clock/sleep are injected.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { configureFeedCache, _resetFeedCacheForTests } from "../lib/feed-cache.js";
import {
  nominatimSearch, nominatimReverse, _resetGeoFeedForTests, MAX_PENDING, osmUserAgent,
} from "../lib/geo-feed-sources.js";

const realFetch = globalThis.fetch;
const res = (body, status = 200) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body });
const place = (n) => ({ place_id: n, lat: "48.85", lon: "2.35", display_name: `Place ${n}`, type: "city" });

let clock;
let calls; // { url, init, at }
let bareFetch;
let route;

beforeEach(() => {
  clock = 1_000_000_000;
  calls = [];
  bareFetch = [];
  route = (url) => res([place(1), place(2), place(3)]);
  _resetFeedCacheForTests();
  _resetGeoFeedForTests();
  configureFeedCache({
    now: () => clock,
    // Sleeping advances the injected clock, so call timestamps show the spacing.
    sleep: async (ms) => { clock += ms; },
    log: () => {},
    logUpstream: null,
  });
  __setPublicFetchTestTransport(async (url, init) => {
    calls.push({ url: String(url), init: init || {}, at: clock });
    return route(String(url));
  });
  globalThis.fetch = (...a) => { bareFetch.push(String(a[0])); throw new Error("bare fetch() is forbidden"); };
});

afterEach(() => {
  __setPublicFetchTestTransport(null);
  globalThis.fetch = realFetch;
  delete process.env.NOMINATIM_BASE;
  _resetFeedCacheForTests();
  _resetGeoFeedForTests();
});

test("three different queries are at least 1000 ms apart", async () => {
  const out = await Promise.all([nominatimSearch("paris"), nominatimSearch("berlin"), nominatimSearch("rome")]);
  assert.ok(out.every((r) => r.ok));
  assert.equal(calls.length, 3);
  assert.ok(calls[1].at - calls[0].at >= 1000, `gap1=${calls[1].at - calls[0].at}`);
  assert.ok(calls[2].at - calls[1].at >= 1000, `gap2=${calls[2].at - calls[1].at}`);
  assert.deepEqual(bareFetch, []);
});

test("search and reverse share the same 1 req/s queue", async () => {
  await Promise.all([nominatimSearch("paris"), nominatimReverse(48.8566, 2.3522)]);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].at - calls[0].at >= 1000);
});

test("the same query (any case or spacing) costs one upstream call", async () => {
  await nominatimSearch("Paris  France");
  await nominatimSearch("  paris france ");
  await nominatimSearch("PARIS FRANCE", { limit: 2 });
  assert.equal(calls.length, 1);
});

test("limit only slices the cached superset", async () => {
  const one = await nominatimSearch("paris", { limit: 1 });
  const three = await nominatimSearch("paris", { limit: 3 });
  assert.equal(one.data.length, 1);
  assert.equal(three.data.length, 3);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /format=jsonv2/);
  assert.match(calls[0].url, /limit=10/);
});

test("reverse keys round to 5 decimals: 7th-decimal jitter is one call", async () => {
  route = () => res({ place_id: 9, display_name: "Somewhere", address: { city: "X" } });
  await nominatimReverse(48.8566001, 2.3522001);
  await nominatimReverse(48.8566004, 2.3522004);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/reverse\?lat=48\.85660&lon=2\.35220/);
  await nominatimReverse(48.8567, 2.3522); // a genuinely different spot
  assert.equal(calls.length, 2);
});

test("every request carries the identifying User-Agent", async () => {
  await nominatimSearch("paris");
  await nominatimReverse(1, 2);
  assert.equal(calls.length, 2);
  for (const c of calls) assert.equal(c.init.headers["User-Agent"], osmUserAgent());
  assert.match(osmUserAgent(), /^Concord-OS\/1\.0 \(.+\)$/);
});

test("NOMINATIM_BASE switches the provider", async () => {
  process.env.NOMINATIM_BASE = "https://geo.example.test/nominatim/";
  await nominatimSearch("paris");
  await nominatimReverse(10, 20);
  assert.ok(calls[0].url.startsWith("https://geo.example.test/nominatim/search?q=paris"));
  assert.ok(calls[1].url.startsWith("https://geo.example.test/nominatim/reverse?"));
});

test("default base is the public instance", async () => {
  await nominatimSearch("paris");
  assert.ok(calls[0].url.startsWith("https://nominatim.openstreetmap.org/search?"));
});

test("queue cap: lookups beyond MAX_PENDING waiting get geocoder_busy, no upstream call", async () => {
  const total = MAX_PENDING + 3;
  const out = await Promise.all(Array.from({ length: total }, (_, i) => nominatimSearch(`town ${i}`)));
  const busy = out.filter((r) => !r.ok);
  assert.equal(busy.length, 3);
  for (const r of busy) {
    assert.equal(r.status, "unavailable");
    assert.equal(r.reason, "geocoder_busy");
  }
  assert.equal(out.filter((r) => r.ok).length, MAX_PENDING);
  assert.equal(calls.length, MAX_PENDING);
  // The queue drains: a new lookup is accepted afterwards.
  const again = await nominatimSearch("after the burst");
  assert.equal(again.ok, true);
});

test("cached answers bypass the queue cap", async () => {
  await nominatimSearch("paris");
  const out = await Promise.all([
    ...Array.from({ length: MAX_PENDING }, (_, i) => nominatimSearch(`fill ${i}`)),
    nominatimSearch("paris"),
  ]);
  assert.ok(out.every((r) => r.ok));
});

test("upstream failure is honest: unavailable, never fabricated data", async () => {
  route = () => res({}, 503);
  const r = await nominatimSearch("nowhere");
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  assert.match(r.reason, /upstream_error/);
  assert.equal(r.data, undefined);
});

test("empty query and bad coordinates never reach the upstream", async () => {
  assert.equal((await nominatimSearch("   ")).ok, false);
  assert.equal((await nominatimReverse("x", 1)).ok, false);
  assert.equal((await nominatimReverse(91, 1)).ok, false);
  assert.equal(calls.length, 0);
});
