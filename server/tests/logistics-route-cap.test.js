// route-optimize geocodes one stop per Nominatim request (1 req/s app-wide), so
// an over-cap request is refused with an honest 4xx BEFORE any network call.
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerLogisticsActions from "../domains/logistics.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { configureFeedCache, _resetFeedCacheForTests } from "../lib/feed-cache.js";
import { _resetGeoFeedForTests } from "../lib/geo-feed-sources.js";

const ACTIONS = new Map();
before(() => { registerLogisticsActions((d, n, fn) => ACTIONS.set(`${d}.${n}`, fn)); });
const ctx = { actor: { userId: "u1" }, userId: "u1" };
const run = (params) => ACTIONS.get("logistics.route-optimize")(ctx, { id: null, data: {}, meta: {} }, params);
const stops = (n) => Array.from({ length: n }, (_, i) => `${i + 1} Main St, Town ${i}`);

const realFetch = globalThis.fetch;
let transport;
let bare;

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  transport = [];
  bare = [];
  _resetFeedCacheForTests();
  _resetGeoFeedForTests();
  configureFeedCache({ now: () => 1_000_000_000, sleep: async () => {}, log: () => {}, logUpstream: null });
  __setPublicFetchTestTransport(async (url) => {
    transport.push(String(url));
    return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) };
  });
  globalThis.fetch = (...a) => { bare.push(String(a[0])); throw new Error("bare fetch() is forbidden"); };
});

afterEach(() => {
  __setPublicFetchTestTransport(null);
  globalThis.fetch = realFetch;
  _resetFeedCacheForTests();
  _resetGeoFeedForTests();
});

test("11 stops without coords: honest 400 and no fetch of any kind", async () => {
  const r = await run({ stops: stops(11) });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /too many stops to geocode: 11 > 10/);
  assert.match(r.error, /params\.coords/);
  assert.deepEqual(transport, []);
  assert.deepEqual(bare, []);
});

test("10 stops are within the cap: geocoding is attempted through the guarded helper", async () => {
  const r = await run({ stops: stops(10) });
  assert.equal(r.ok, false);
  assert.notEqual(r.status, 400);
  assert.match(r.error, /geocoding unreachable/);
  assert.equal(transport.length, 1); // first stop fails (503) and stops the loop
  assert.match(transport[0], /nominatim\.openstreetmap\.org\/search/);
  assert.deepEqual(bare, []);
});

test("caller-supplied coords skip geocoding, so the cap does not apply", async () => {
  const coords = stops(12).map((_, i) => ({ lat: 40 + i / 100, lng: -74 }));
  const r = await run({ stops: stops(12), coords });
  // Fails later at OSRM (no network in tests), never with the geocode-cap error.
  assert.doesNotMatch(String(r.error || ""), /too many stops to geocode/);
  assert.equal(transport.length, 0);
});
