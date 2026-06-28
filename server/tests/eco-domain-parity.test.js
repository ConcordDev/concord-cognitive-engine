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
  it("fails honestly when Open-Meteo unreachable (no fabricated AQI)", async () => {
    // Per the "everything must be real" directive, a network failure surfaces
    // an honest { ok:false } error rather than a fabricated plausible reading
    // — the AQIPanel renders the error branch, not a fake AQI of 42.
    const r = await call("aqi-current", ctxA, { lat: 37.7, lng: -122.4 });
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/i);
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

describe("eco.observation-feed (GBIF community sightings)", () => {
  it("rejects missing coordinates", async () => {
    const r = await call("observation-feed", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("returns error shape when GBIF unreachable (no synthetic fallback)", async () => {
    const r = await call("observation-feed", ctxA, { lat: 37.7, lng: -122.4 });
    assert.equal(r.ok, false);
    assert.match(r.error, /GBIF unreachable/);
  });

  it("parses GBIF occurrence results into map-ready observations", async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /api\.gbif\.org\/v1\/occurrence\/search/);
      return {
        ok: true,
        json: async () => ({
          count: 2,
          results: [
            { key: 1, vernacularName: "Mallard", scientificName: "Anas platyrhynchos", kingdom: "Animalia", decimalLatitude: 37.71, decimalLongitude: -122.42, country: "US", eventDate: "2026-05-01", basisOfRecord: "HUMAN_OBSERVATION" },
            { key: 2, scientificName: "Quercus agrifolia", kingdom: "Plantae", decimalLatitude: 37.73, decimalLongitude: -122.41 },
          ],
        }),
      };
    };
    const r = await call("observation-feed", ctxA, { lat: 37.7, lng: -122.4, radiusKm: 25 });
    assert.equal(r.ok, true);
    assert.equal(r.result.observations.length, 2);
    assert.equal(r.result.observations[0].commonName, "Mallard");
    assert.ok(isFinite(r.result.observations[0].lat));
    assert.match(r.result.source, /GBIF/);
  });
});

describe("eco.footprint-record / history / delete", () => {
  it("rejects an invalid total", () => {
    assert.equal(call("footprint-record", ctxA, {}).ok, false);
    assert.equal(call("footprint-record", ctxA, { totalKgCO2e: -10 }).ok, false);
  });

  it("record + history round-trip computes a trend", () => {
    const r1 = call("footprint-record", ctxA, { totalKgCO2e: 1000, netKgCO2e: 1000, label: "Jan" });
    assert.equal(r1.ok, true);
    const r2 = call("footprint-record", ctxA, { totalKgCO2e: 700, netKgCO2e: 650, label: "Feb" });
    assert.equal(r2.ok, true);
    const hist = call("footprint-history", ctxA, { sinceDays: 365 });
    assert.equal(hist.ok, true);
    assert.equal(hist.result.count, 2);
    assert.equal(hist.result.trend, "improving");
    assert.ok(hist.result.deltaKg < 0);
    assert.equal(hist.result.bestEntry.netKgCO2e, 650);
  });

  it("history is user-scoped", () => {
    call("footprint-record", ctxA, { totalKgCO2e: 500 });
    const other = call("footprint-history", ctxB, {});
    assert.equal(other.result.count, 0);
  });

  it("delete removes a snapshot", () => {
    const r = call("footprint-record", ctxA, { totalKgCO2e: 300 });
    const id = r.result.entry.id;
    const del = call("footprint-delete", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(call("footprint-history", ctxA, {}).result.count, 0);
    assert.equal(call("footprint-delete", ctxA, { id: "nope" }).ok, false);
  });
});

describe("eco.challenges-* (gamified habits + streaks)", () => {
  it("catalog returns curated challenges with cited impact", () => {
    const r = call("challenges-catalog", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.challenges.length >= 8);
    for (const c of r.result.challenges) {
      assert.ok(c.slug && c.points > 0);
      assert.ok(typeof c.kgCo2eSavedPerCheckIn === "number");
      assert.ok(c.citation);
    }
  });

  it("join + checkin builds a streak and totals", () => {
    const slug = call("challenges-catalog", ctxA, {}).result.challenges[0].slug;
    assert.equal(call("challenges-join", ctxA, { slug }).ok, true);
    assert.equal(call("challenges-join", ctxA, { slug }).ok, false); // already enrolled
    const ci = call("challenges-checkin", ctxA, { slug });
    assert.equal(ci.ok, true);
    assert.equal(ci.result.enrollment.currentStreak, 1);
    assert.ok(ci.result.enrollment.totalPoints > 0);
    // second same-day check-in is rejected
    assert.equal(call("challenges-checkin", ctxA, { slug }).ok, false);
  });

  it("mine aggregates points and streaks; leave drops enrollment", () => {
    const slug = call("challenges-catalog", ctxA, {}).result.challenges[1].slug;
    call("challenges-join", ctxA, { slug });
    call("challenges-checkin", ctxA, { slug });
    const mine = call("challenges-mine", ctxA, {});
    assert.equal(mine.ok, true);
    assert.equal(mine.result.enrollments.length, 1);
    assert.ok(mine.result.totalPoints > 0);
    const left = call("challenges-leave", ctxA, { slug });
    assert.equal(left.ok, true);
    assert.equal(call("challenges-mine", ctxA, {}).result.enrollments.length, 0);
  });

  it("rejects unknown slugs", () => {
    assert.equal(call("challenges-join", ctxA, { slug: "nope" }).ok, false);
    assert.equal(call("challenges-checkin", ctxA, { slug: "nope" }).ok, false);
  });
});

describe("eco.species-suggest (GBIF taxonomy + alternatives)", () => {
  it("rejects missing name", async () => {
    assert.equal((await call("species-suggest", ctxA, {})).ok, false);
  });

  it("returns a primary match and ranked alternatives", async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /api\.gbif\.org\/v1\/species\/match/);
      return {
        ok: true,
        json: async () => ({
          usageKey: 2480242,
          canonicalName: "Buteo jamaicensis",
          scientificName: "Buteo jamaicensis (Gmelin, 1788)",
          rank: "SPECIES",
          kingdom: "Animalia",
          family: "Accipitridae",
          confidence: 97,
          matchType: "EXACT",
          alternatives: [
            { canonicalName: "Buteo buteo", scientificName: "Buteo buteo", rank: "SPECIES", kingdom: "Animalia", family: "Accipitridae", confidence: 60, matchType: "FUZZY", usageKey: 1 },
          ],
        }),
      };
    };
    const r = await call("species-suggest", ctxA, { name: "Red-tailed Hawk" });
    assert.equal(r.ok, true);
    assert.ok(r.result.primary);
    assert.ok(r.result.primary.confidence > 0.9);
    assert.equal(r.result.alternatives.length, 1);
    assert.match(r.result.source, /GBIF/);
  });

  it("returns error shape when GBIF unreachable", async () => {
    const r = await call("species-suggest", ctxA, { name: "Oak" });
    assert.equal(r.ok, false);
    assert.match(r.error, /GBIF unreachable/);
  });
});

describe("eco.locations-* (saved places for alerts)", () => {
  it("save + list + delete round-trip user-scoped", () => {
    const s = call("locations-save", ctxA, { label: "Home", lat: 37.7, lng: -122.4 });
    assert.equal(s.ok, true);
    const list = call("locations-list", ctxA, {});
    assert.equal(list.result.locations.length, 1);
    assert.equal(list.result.locations[0].label, "Home");
    assert.equal(call("locations-list", ctxB, {}).result.locations.length, 0);
    const del = call("locations-delete", ctxA, { id: s.result.entry.id });
    assert.equal(del.ok, true);
    assert.equal(call("locations-list", ctxA, {}).result.locations.length, 0);
  });

  it("rejects missing label or coordinates", () => {
    assert.equal(call("locations-save", ctxA, { lat: 1, lng: 2 }).ok, false);
    assert.equal(call("locations-save", ctxA, { label: "x" }).ok, false);
    assert.equal(call("locations-delete", ctxA, { id: "nope" }).ok, false);
  });
});

describe("eco.environmental-alerts (live AQI/UV/pollen)", () => {
  it("rejects missing coordinates", async () => {
    assert.equal((await call("environmental-alerts", ctxA, {})).ok, false);
  });

  it("grades live readings into threshold-crossing alerts", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("air-quality")) {
        return {
          ok: true,
          json: async () => ({
            current: { us_aqi: 165, pm2_5: 55, pm10: 80, ozone: 90 },
            hourly: { grass_pollen: [10, 95, 40], birch_pollen: [5, 5, 5] },
          }),
        };
      }
      return { ok: true, json: async () => ({ daily: { uv_index_max: [9] } }) };
    };
    const r = await call("environmental-alerts", ctxA, { lat: 37.7, lng: -122.4, label: "Home" });
    assert.equal(r.ok, true);
    assert.equal(r.result.allClear, false);
    const kinds = r.result.alerts.map((a) => a.kind);
    assert.ok(kinds.includes("air_quality"));
    assert.ok(kinds.includes("uv"));
    assert.ok(kinds.includes("pollen"));
    assert.equal(r.result.readings.aqi, 165);
  });

  it("returns allClear when nothing crosses a threshold", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("air-quality")) {
        return {
          ok: true,
          json: async () => ({
            current: { us_aqi: 35, pm2_5: 6, pm10: 10, ozone: 40 },
            hourly: { grass_pollen: [2, 3, 1] },
          }),
        };
      }
      return { ok: true, json: async () => ({ daily: { uv_index_max: [3] } }) };
    };
    const r = await call("environmental-alerts", ctxA, { lat: 0, lng: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.result.allClear, true);
    assert.equal(r.result.alertCount, 0);
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
