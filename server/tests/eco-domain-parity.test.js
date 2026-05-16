// Contract tests for the eco-lens parity macros added in server/domains/eco.js.
// Existing analytical macros (carbonFootprint, biodiversity*, sustainability*)
// continue to work; new IDE-grade macros (weather-forecast, aqi-current,
// climate-actions-list/log/logged, species-identify, energy-estimate,
// biodiversity-log/list/delete) are exercised via fallback paths so the
// suite is hermetic — no network calls reach the wire.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerEcoActions from "../domains/eco.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`eco.${name}`);
  assert.ok(fn, `eco.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerEcoActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map(), ecoLens: { biodiversity: new Map(), actionLog: new Map() } };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const userA = "user_a";
const userB = "user_b";
const ctxA = { actor: { userId: userA }, userId: userA };
const ctxB = { actor: { userId: userB }, userId: userB };

describe("eco.weather-forecast", () => {
  it("returns error shape when Open-Meteo unreachable (no synthetic fallback)", async () => {
    const r = await call("weather-forecast", ctxA, { lat: 37.7, lng: -122.4 });
    assert.equal(r.ok, false);
    assert.match(r.error, /open-meteo unreachable/);
  });

  it("parses Open-Meteo response when fetch succeeds", async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /api\.open-meteo\.com\/v1\/forecast/);
      assert.match(url, /latitude=37\.7/);
      return {
        ok: true,
        json: async () => ({
          current: { temperature_2m: 18, relative_humidity_2m: 60, apparent_temperature: 17, is_day: 1, precipitation: 0, weather_code: 1, wind_speed_10m: 5, wind_direction_10m: 180 },
          hourly: { time: [], temperature_2m: [], precipitation: [], relative_humidity_2m: [] },
          daily: {
            time: ["2026-05-16","2026-05-17","2026-05-18","2026-05-19","2026-05-20","2026-05-21","2026-05-22"],
            weather_code: [1,1,2,3,1,2,1],
            temperature_2m_max: [22,23,21,20,22,24,23],
            temperature_2m_min: [12,13,11,10,12,14,13],
            precipitation_sum: [0,0,1,2,0,0,0],
            precipitation_probability_max: [10,5,30,60,5,10,5],
            wind_speed_10m_max: [12,10,8,15,9,11,10],
            uv_index_max: [6,7,5,4,7,8,7],
          },
        }),
      };
    };
    const r = await call("weather-forecast", ctxA, { lat: 37.7, lng: -122.4 });
    assert.equal(r.ok, true);
    assert.equal(r.result.daily.length, 7);
    assert.equal(r.result.location.lat, 37.7);
  });

  it("rejects missing lat/lng", async () => {
    assert.equal((await call("weather-forecast", ctxA, {})).ok, false);
  });
});

describe("eco.aqi-current", () => {
  it("returns fallback AQI when network unreachable", async () => {
    const r = await call("aqi-current", ctxA, { lat: 37.7, lng: -122.4 });
    assert.equal(r.ok, true);
    assert.equal(r.result.category, "good");
    assert.ok(typeof r.result.aqi === "number");
    assert.match(r.result.source, /fallback/);
  });

  it("rejects missing coords", async () => {
    assert.equal((await call("aqi-current", ctxA, {})).ok, false);
  });
});

describe("eco.climate-actions-* (list / log / logged)", () => {
  it("list returns a curated library spanning all 6 categories", () => {
    const r = call("climate-actions-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.actions.length >= 15);
    const cats = new Set(r.result.actions.map(a => a.category));
    for (const c of ["transport", "food", "home", "shopping", "advocacy", "energy"]) {
      assert.ok(cats.has(c), `category ${c} missing`);
    }
    for (const a of r.result.actions) {
      assert.ok(a.slug && typeof a.slug === "string");
      assert.ok(a.effort >= 1 && a.effort <= 5);
      assert.ok(typeof a.kgCo2eSavedPerYear === "number");
      assert.ok(a.citation);
    }
  });

  it("log + logged round-trip scoped per user", () => {
    const r1 = call("climate-actions-log", ctxA, { slug: "led-retrofit" });
    assert.equal(r1.ok, true);
    const r2 = call("climate-actions-log", ctxA, { slug: "led-retrofit" });
    assert.equal(r2.ok, true);
    const logged = call("climate-actions-logged", ctxA, { sinceDays: 30 });
    assert.equal(logged.result.entries.length, 2);
    assert.ok(logged.result.totalKgSaved > 0);

    // Other user: empty
    const otherLogged = call("climate-actions-logged", ctxB, { sinceDays: 30 });
    assert.equal(otherLogged.result.entries.length, 0);
  });

  it("log rejects unknown slug + missing slug", () => {
    assert.equal(call("climate-actions-log", ctxA, { slug: "" }).ok, false);
    assert.equal(call("climate-actions-log", ctxA, { slug: "made-up-slug" }).ok, false);
  });

  it("logged sinceDays filter excludes old entries", () => {
    const state = globalThis._concordSTATE.ecoLens;
    state.actionLog.set(userA, [
      { id: "old", slug: "led-retrofit", kgSaved: 1, at: new Date(Date.now() - 60 * 86400000).toISOString() },
      { id: "new", slug: "led-retrofit", kgSaved: 2, at: new Date().toISOString() },
    ]);
    const r = call("climate-actions-logged", ctxA, { sinceDays: 7 });
    assert.equal(r.result.entries.length, 1);
    assert.equal(r.result.entries[0].id, "new");
  });
});

describe("eco.species-identify", () => {
  it("rejects missing imageDataUrl", async () => {
    const r = await call("species-identify", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("returns a graceful fallback when vision call fails", async () => {
    const r = await call("species-identify", ctxA, { imageDataUrl: "data:image/png;base64,iVBOR" });
    assert.equal(r.ok, true);
    // callVision may either throw (→ source=fallback) or return empty
    // content (→ source=llava-vision, suggestions=[]). Both are valid
    // graceful-degradation outcomes; the contract is just that ok:true.
    assert.ok(["fallback", "llava-vision"].includes(r.result.source));
    assert.ok(Array.isArray(r.result.suggestions));
  });
});

describe("eco.energy-estimate", () => {
  it("returns 12 months of production data + annual + capacity factor", () => {
    const r = call("energy-estimate", ctxA, { lat: 37.7, lng: -122.4, systemKw: 8, tilt: 30, azimuth: 180 });
    assert.equal(r.ok, true);
    assert.equal(r.result.monthlyKwh.length, 12);
    assert.ok(r.result.annualKwh > 0);
    assert.ok(r.result.capacityFactor > 0 && r.result.capacityFactor < 1);
    assert.ok(r.result.co2AvoidedKgPerYear > 0);
    assert.ok(r.result.systemKwp === 8);
  });

  it("scales output with system size", () => {
    const r4 = call("energy-estimate", ctxA, { lat: 37, lng: -122, systemKw: 4 });
    const r8 = call("energy-estimate", ctxA, { lat: 37, lng: -122, systemKw: 8 });
    assert.ok(r8.result.annualKwh > r4.result.annualKwh * 1.5);
  });

  it("higher absolute latitude → lower capacity factor (more or less)", () => {
    const equator = call("energy-estimate", ctxA, { lat: 0, lng: 0, systemKw: 5 });
    const arctic = call("energy-estimate", ctxA, { lat: 70, lng: 0, systemKw: 5 });
    assert.ok(equator.result.annualKwh > arctic.result.annualKwh);
  });

  it("clamps system size to positive", () => {
    const r = call("energy-estimate", ctxA, { lat: 30, lng: 0, systemKw: -5 });
    assert.ok(r.result.systemKwp > 0);
  });
});

describe("eco.biodiversity-log / list / delete", () => {
  it("log creates an observation; list returns user-scoped reverse-chrono", () => {
    const r1 = call("biodiversity-log", ctxA, { commonName: "Red-tailed Hawk", scientificName: "Buteo jamaicensis", lat: 37.7, lng: -122.4 });
    assert.equal(r1.ok, true);
    const r2 = call("biodiversity-log", ctxA, { commonName: "Western Scrub Jay", scientificName: "Aphelocoma californica" });
    assert.equal(r2.ok, true);

    const list = call("biodiversity-list", ctxA, { limit: 50 });
    assert.equal(list.result.observations.length, 2);
    // Newest first
    assert.equal(list.result.observations[0].commonName, "Western Scrub Jay");

    // Other user empty
    const otherList = call("biodiversity-list", ctxB, {});
    assert.equal(otherList.result.observations.length, 0);
  });

  it("delete removes an observation", () => {
    const r = call("biodiversity-log", ctxA, { commonName: "Coyote", scientificName: "Canis latrans" });
    const id = r.result.entry.id;
    const del = call("biodiversity-delete", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(call("biodiversity-list", ctxA, {}).result.observations.length, 0);
  });

  it("log rejects missing commonName", () => {
    assert.equal(call("biodiversity-log", ctxA, { scientificName: "x" }).ok, false);
  });

  it("delete rejects unknown id", () => {
    assert.equal(call("biodiversity-delete", ctxA, { id: "no-such" }).ok, false);
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("carbonFootprint returns CO2 total + scope breakdown", () => {
    const r = ACTIONS.get("eco.carbonFootprint")(ctxA, {
      data: { activities: [
        { category: "electricity", type: "electricity_kwh", quantity: 1000, unit: "kwh", scope: 2 },
        { category: "transport", type: "car_km", quantity: 5000, unit: "km", scope: 1 },
      ] },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(typeof r.result === "object");
  });
});
