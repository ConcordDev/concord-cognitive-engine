/**
 * Tier-2 contract test for Phase 4 free-API macro registrations.
 *
 * Pins:
 *   - astronomy-live registers expected macros
 *   - free-api-live registers expected macros
 *   - pharmacy-live registers expected macros
 *   - input validation rejections happen at the macro layer (no live HTTP)
 *
 * Live external fetches are NOT exercised here (would make CI flaky on
 * NASA / OpenFDA / NOAA outages). Live wire-up is verified manually via
 * the lens panels; this file pins the registration + input contract.
 *
 * Run: node --test server/tests/free-api-live-registration.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import registerAstronomyLiveMacros from "../domains/astronomy-live.js";
import registerFreeApiLiveMacros from "../domains/free-api-live.js";
import registerPharmacyLiveMacros from "../domains/pharmacy-live.js";

function makeRegistry() {
  const map = new Map();
  const register = (domain, name, handler, meta) => {
    map.set(`${domain}.${name}`, { handler, meta });
  };
  return { register, map };
}

describe("astronomy-live macro registration", () => {
  it("registers live_apod, live_iss, live_neo", () => {
    const r = makeRegistry();
    registerAstronomyLiveMacros(r.register);
    assert.ok(r.map.has("astronomy.live_apod"));
    assert.ok(r.map.has("astronomy.live_iss"));
    assert.ok(r.map.has("astronomy.live_neo"));
  });

  it("each macro has a note for /api/lens introspection", () => {
    const r = makeRegistry();
    registerAstronomyLiveMacros(r.register);
    for (const key of ["astronomy.live_apod", "astronomy.live_iss", "astronomy.live_neo"]) {
      const entry = r.map.get(key);
      assert.ok(entry.meta?.note, `${key} missing note metadata`);
    }
  });
});

describe("free-api-live macro registration", () => {
  it("registers all 6 free-API macros across 5 domains", () => {
    const r = makeRegistry();
    registerFreeApiLiveMacros(r.register);
    assert.ok(r.map.has("geology.live_quakes_today"));
    assert.ok(r.map.has("atlas.live_geocode"));
    assert.ok(r.map.has("ocean.live_tides"));
    assert.ok(r.map.has("history.live_wiki_otd"));
    assert.ok(r.map.has("cooking.live_food_search"));
    assert.ok(r.map.has("food.live_food_search"));
  });
});

describe("cooking.live_food_search input validation", () => {
  it("rejects missing query", async () => {
    const r = makeRegistry();
    registerFreeApiLiveMacros(r.register);
    const handler = r.map.get("cooking.live_food_search").handler;
    const res = await handler({}, {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_query");
  });

  it("rejects overlong query", async () => {
    const r = makeRegistry();
    registerFreeApiLiveMacros(r.register);
    const handler = r.map.get("cooking.live_food_search").handler;
    const res = await handler({}, { query: "x".repeat(200) });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "query_too_long");
  });

  it("cooking and food share the same handler instance", () => {
    const r = makeRegistry();
    registerFreeApiLiveMacros(r.register);
    const cookingHandler = r.map.get("cooking.live_food_search").handler;
    const foodHandler = r.map.get("food.live_food_search").handler;
    assert.equal(cookingHandler, foodHandler);
  });
});

describe("pharmacy-live macro registration", () => {
  it("registers live_label_lookup, live_adverse_events, live_recalls", () => {
    const r = makeRegistry();
    registerPharmacyLiveMacros(r.register);
    assert.ok(r.map.has("pharmacy.live_label_lookup"));
    assert.ok(r.map.has("pharmacy.live_adverse_events"));
    assert.ok(r.map.has("pharmacy.live_recalls"));
  });
});

describe("atlas.live_geocode input validation", () => {
  it("rejects missing query", async () => {
    const r = makeRegistry();
    registerFreeApiLiveMacros(r.register);
    const handler = r.map.get("atlas.live_geocode").handler;
    const res = await handler({}, {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_query");
  });

  it("rejects overlong query", async () => {
    const r = makeRegistry();
    registerFreeApiLiveMacros(r.register);
    const handler = r.map.get("atlas.live_geocode").handler;
    const res = await handler({}, { query: "x".repeat(300) });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "query_too_long");
  });
});

describe("ocean.live_tides input validation", () => {
  it("rejects non-7-digit station id", async () => {
    const r = makeRegistry();
    registerFreeApiLiveMacros(r.register);
    const handler = r.map.get("ocean.live_tides").handler;
    const res = await handler({}, { station: "not-a-station" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_station");
  });
});

describe("pharmacy.live_label_lookup input validation", () => {
  it("rejects missing query", async () => {
    const r = makeRegistry();
    registerPharmacyLiveMacros(r.register);
    const handler = r.map.get("pharmacy.live_label_lookup").handler;
    const res = await handler({}, {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_query");
  });

  it("rejects overlong query", async () => {
    const r = makeRegistry();
    registerPharmacyLiveMacros(r.register);
    const handler = r.map.get("pharmacy.live_label_lookup").handler;
    const res = await handler({}, { query: "x".repeat(200) });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "query_too_long");
  });
});
