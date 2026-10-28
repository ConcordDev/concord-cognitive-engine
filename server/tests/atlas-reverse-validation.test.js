// atlas.nominatim-reverse: bad coordinates are an input error (HTTP 400
// invalid_input, no upstream call), never a "geocoder unreachable" outage.
// "unreachable" is reserved for real upstream failures. No network: the
// public-fetch test transport is injected, as in nominatim-limit.test.js.
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerAtlasActions from "../domains/atlas.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { configureFeedCache, _resetFeedCacheForTests } from "../lib/feed-cache.js";
import { _resetGeoFeedForTests } from "../lib/geo-feed-sources.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
const reverse = (params) => ACTIONS.get("atlas.nominatim-reverse")({}, { id: null, data: {}, meta: {} }, params);

const realFetch = globalThis.fetch;
let clock;
let calls;
let route;

before(() => { registerAtlasActions(register); });

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

test("out-of-range / non-numeric / missing coordinates are invalid_input with no fetch", async () => {
  const cases = [
    [{ latitude: 91, longitude: 0 }, "latitude"],
    [{ latitude: 0, longitude: 181 }, "longitude"],
    [{ latitude: "abc", longitude: 0 }, "latitude"],
    [{ longitude: 0 }, "latitude"],
    [{ latitude: 48.85 }, "longitude"],
  ];
  for (const [params, field] of cases) {
    const r = await reverse(params);
    assert.equal(r.ok, false, JSON.stringify(params));
    assert.equal(r.error, "invalid_input", JSON.stringify(params));
    assert.equal(r.field, field, JSON.stringify(params));
    assert.equal(shapeLensRunHttp(r).status, 400, JSON.stringify(params));
  }
  assert.equal(calls.length, 0);
});

test("a missing coordinate says reason:required", async () => {
  const r = await reverse({ longitude: 2.35 });
  assert.equal(r.error, "invalid_input");
  assert.equal(r.reason, "required");
});

test("a valid coordinate is still served", async () => {
  const r = await reverse({ latitude: 48.85, longitude: 2.35 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.displayName, "Rue de Test, Paris");
  assert.equal(r.result.source, "openstreetmap-nominatim");
  assert.equal(calls.length, 1);
});

test("an upstream outage is the honest unavailable, and only then says unreachable", async () => {
  route = () => ({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) });
  const r = await reverse({ latitude: 48.85, longitude: 2.35 });
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  assert.match(r.error, /^nominatim unreachable: /);
  // Note: the geo layer's outage reason ("upstream_error: nominatim 503")
  // does not carry one of lens-run-http's *_unreachable tokens, so the HTTP
  // status for a real outage is unchanged by this PR (pre-existing mapper
  // behaviour, flagged in the PR description).
});
