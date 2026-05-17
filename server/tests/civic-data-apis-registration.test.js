/**
 * Tier-2 contract test for the sixth-wave civic REAL free-API macro
 * registrations (civic-data-apis.js — World Bank, Open Brewery DB,
 * Dog CEO, Zippopotam, Open Notify ISS pass times).
 *
 * Pins:
 *   - all 11 expected (domain, macro) pairs register
 *   - shared handlers identity across domains
 *   - input validation rejects bad inputs without hitting upstream
 *   - every macro has a note for /api/lens introspection
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import registerCivicDataApiMacros from "../domains/civic-data-apis.js";

function makeRegistry() {
  const map = new Map();
  const register = (domain, name, handler, meta) => {
    map.set(`${domain}.${name}`, { handler, meta });
  };
  return { register, map };
}

const EXPECTED_PAIRS = [
  "global.live_worldbank",
  "finance.live_worldbank",
  "food.live_breweries",
  "cooking.live_breweries",
  "pets.live_dog",
  "retail.live_zippopotam",
  "logistics.live_zippopotam",
  "travel.live_zippopotam",
  "astronomy.live_iss_pass",
  "space.live_iss_pass",
];

describe("civic-data-apis registration", () => {
  it("registers all expected (domain, macro) pairs", () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    for (const key of EXPECTED_PAIRS) {
      assert.ok(r.map.has(key), `missing registration: ${key}`);
    }
  });

  it("each macro has a note", () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    for (const key of EXPECTED_PAIRS) {
      assert.ok(r.map.get(key).meta?.note, `${key} missing note`);
    }
  });
});

describe("shared handler identity", () => {
  it("World Bank handler shared across global + finance", () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    assert.equal(
      r.map.get("global.live_worldbank").handler,
      r.map.get("finance.live_worldbank").handler,
    );
  });

  it("Open Brewery handler shared across food + cooking", () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    assert.equal(
      r.map.get("food.live_breweries").handler,
      r.map.get("cooking.live_breweries").handler,
    );
  });

  it("Zippopotam handler shared across retail + logistics + travel", () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    const a = r.map.get("retail.live_zippopotam").handler;
    const b = r.map.get("logistics.live_zippopotam").handler;
    const c = r.map.get("travel.live_zippopotam").handler;
    assert.equal(a, b);
    assert.equal(a, c);
  });

  it("ISS pass handler shared across astronomy + space", () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    assert.equal(
      r.map.get("astronomy.live_iss_pass").handler,
      r.map.get("space.live_iss_pass").handler,
    );
  });
});

describe("World Bank input validation", () => {
  it("rejects invalid country code", async () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    const res = await r.map.get("global.live_worldbank").handler({}, { country: "123" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_country_code");
  });

  it("rejects invalid indicator", async () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    const res = await r.map.get("global.live_worldbank").handler({}, { country: "US", indicator: "evil$$$" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_indicator");
  });
});

describe("Zippopotam input validation", () => {
  it("rejects invalid country code", async () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    const res = await r.map.get("retail.live_zippopotam").handler({}, { country: "USA", postalCode: "10001" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_country_code");
  });

  it("rejects missing postal code", async () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    const res = await r.map.get("retail.live_zippopotam").handler({}, { country: "us" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_postal_code");
  });
});

describe("ISS pass input validation", () => {
  it("rejects invalid latitude", async () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    const res = await r.map.get("astronomy.live_iss_pass").handler({}, { latitude: 200, longitude: 0 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_latitude");
  });

  it("rejects invalid longitude", async () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    const res = await r.map.get("astronomy.live_iss_pass").handler({}, { latitude: 0, longitude: 999 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_longitude");
  });

  it("rejects missing latitude", async () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    const res = await r.map.get("astronomy.live_iss_pass").handler({}, { longitude: 0 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_latitude");
  });
});

describe("Open Brewery input validation", () => {
  it("rejects overlong query", async () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    const res = await r.map.get("food.live_breweries").handler({}, { query: "x".repeat(200) });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "query_too_long");
  });

  it("permits empty input (returns nationwide sample)", () => {
    const r = makeRegistry();
    registerCivicDataApiMacros(r.register);
    // Just verify it's callable.
    const result = r.map.get("food.live_breweries").handler({}, {});
    assert.ok(typeof result.then === "function");
  });
});
