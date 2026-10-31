// Geocoder outages are NOT input errors: a real Nominatim failure (upstream
// 5xx, timeout/network throw, queue-full) returns the opt-in
// geocoder_unavailable shape, which lens-run-http maps to HTTP 503. Bad
// input stays 400 invalid_input (see atlas-reverse-validation.test.js).
// No network: the public-fetch test transport is injected, as in
// atlas-reverse-validation.test.js / nominatim-limit.test.js.
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerAtlasActions from "../domains/atlas.js";
import registerAutomotiveActions from "../domains/automotive.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { configureFeedCache, _resetFeedCacheForTests } from "../lib/feed-cache.js";
import { _resetGeoFeedForTests, MAX_PENDING } from "../lib/geo-feed-sources.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
const geocode = (params) => ACTIONS.get("atlas.nominatim-geocode")({}, { id: null, data: {}, meta: {} }, params);
const reverse = (params) => ACTIONS.get("atlas.nominatim-reverse")({}, { id: null, data: {}, meta: {} }, params);
const shopsGeocode = (params) => ACTIONS.get("automotive.shops-geocode")({}, { id: null, data: {}, meta: {} }, params);

const realFetch = globalThis.fetch;
let clock;
let calls;
let route;

before(() => { registerAtlasActions(register); registerAutomotiveActions(register); });

beforeEach(() => {
  clock = 1_000_000_000;
  calls = [];
  route = (url) => url.includes("reverse")
    ? { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ display_name: "Rue de Test, Paris", osm_type: "way", osm_id: 1, address: { city: "Paris" } }) }
    : { ok: true, status: 200, headers: { get: () => null }, json: async () => [] };
  _resetFeedCacheForTests();
  _resetGeoFeedForTests();
  configureFeedCache({
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    log: () => {},
    logUpstream: null,
  });
  __setPublicFetchTestTransport(async (url, init) => {
    calls.push({ url: String(url), init: init || {}, at: clock });
    return route(String(url));
  });
  globalThis.fetch = () => { throw new Error("bare fetch() is forbidden"); };
});

afterEach(() => {
  __setPublicFetchTestTransport(null);
  globalThis.fetch = realFetch;
  delete process.env.NOMINATIM_BASE;
  _resetFeedCacheForTests();
  _resetGeoFeedForTests();
});

function assertGeocoderUnavailable(r, retryAfterS) {
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.status, "unavailable", JSON.stringify(r));
  assert.equal(r.code, "geocoder_unavailable", JSON.stringify(r));
  assert.equal(r.error, "geocoder_unavailable", JSON.stringify(r));
  assert.equal(r.retryAfterS, retryAfterS, JSON.stringify(r));
  assert.equal(shapeLensRunHttp(r).status, 503, JSON.stringify(r));
}

test("an upstream 503 gives geocoder_unavailable + HTTP 503 (geocode and reverse)", async () => {
  route = () => ({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) });
  assertGeocoderUnavailable(await geocode({ query: "paris" }), 30);
  assertGeocoderUnavailable(await reverse({ latitude: 48.85, longitude: 2.35 }), 30);
});

test("a network throw / timeout gives geocoder_unavailable + HTTP 503", async () => {
  route = () => { throw new Error("socket timeout"); };
  const r = await reverse({ latitude: 48.85, longitude: 2.35 });
  assertGeocoderUnavailable(r, 30);
  assert.ok(String(r.reason || "").length > 0, "reason is carried for debugging");
});

test("a full geocoder queue gives geocoder_unavailable with reason geocoder_busy", async () => {
  // Occupy every pending slot with distinct forward lookups, then reverse:
  // via() refuses before any upstream call.
  const pending = Array.from({ length: MAX_PENDING }, (_, i) => geocode({ query: `town ${i}` }));
  const r = await reverse({ latitude: 1, longitude: 2 });
  assert.equal(r.reason, "geocoder_busy", JSON.stringify(r));
  assertGeocoderUnavailable(r, 5);
  const drained = await Promise.all(pending);
  assert.ok(drained.every((d) => d.ok), "the queued lookups themselves still succeed");
});

test("a blank forward query is invalid_input 400 with no upstream call", async () => {
  for (const params of [{ query: "   " }, { query: "" }, {}]) {
    const r = await geocode(params);
    assert.equal(r.ok, false, JSON.stringify(params));
    assert.equal(r.error, "invalid_input", JSON.stringify(params));
    assert.equal(r.field, "query", JSON.stringify(params));
    assert.equal(r.reason, "required", JSON.stringify(params));
    assert.equal(shapeLensRunHttp(r).status, 400, JSON.stringify(params));
  }
  assert.equal(calls.length, 0);
});

test("a valid call still succeeds", async () => {
  const r = await reverse({ latitude: 48.85, longitude: 2.35 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.displayName, "Rue de Test, Paris");
});

test("automotive shops-geocode uses the same outage mapping (same Nominatim door)", async () => {
  route = () => ({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) });
  assertGeocoderUnavailable(await shopsGeocode({ query: "123 main st" }), 30);
  const bad = await shopsGeocode({ query: " " });
  assert.equal(bad.error, "invalid_input");
  assert.equal(bad.field, "query");
  assert.equal(shapeLensRunHttp(bad).status, 400);
});
