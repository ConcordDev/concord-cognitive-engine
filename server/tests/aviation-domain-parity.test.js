// Tier-2 contract tests for aviation lens parity macros
// (airport-lookup / weather-metar / weather-taf / perf-takeoff / perf-landing / plans).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAviationActions from "../domains/aviation.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`aviation.${name}`);
  if (!fn) throw new Error(`aviation.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAviationActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("aviation — airport lookup (aviationapi.com / FAA NASR live)", () => {
  it("rejects missing ident", async () => {
    const r = await call("airport-lookup", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /ident required/);
  });

  it("returns error when network is disabled (hermetic test)", async () => {
    // beforeEach mocks fetch to throw — verify real fetch is wired
    const r = await call("airport-lookup", ctxA, { ident: "KSFO" });
    assert.equal(r.ok, false);
    assert.match(r.error, /failed|network/);
  });

  it("happy-path: parses aviationapi.com response shape", async () => {
    let callCount = 0;
    globalThis.fetch = async (url) => {
      callCount++;
      if (url.includes("frequencies")) {
        return {
          ok: true,
          json: async () => ({ KSFO: [
            { freq: "120.5", freq_use: "Tower" },
            { freq: "121.8", freq_use: "Ground" },
            { freq: "118.85", freq_use: "ATIS" },
          ] }),
        };
      }
      if (url.includes("runways")) {
        return {
          ok: true,
          json: async () => ({ KSFO: [
            { id: "10R/28L", length: 11870, surface_type_code: "ASPH" },
            { id: "10L/28R", length: 11381, surface_type_code: "ASPH" },
          ] }),
        };
      }
      return {
        ok: true,
        json: async () => ({ KSFO: [{
          facility_name: "San Francisco Intl", city: "San Francisco", state_code: "CA",
          latitude_decimal: 37.6189, longitude_decimal: -122.3750, elevation: 13,
          fuel_types: "100LL, JetA",
        }] }),
      };
    };
    const r = await call("airport-lookup", ctxA, { ident: "KSFO" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "aviationapi.com (FAA NASR)");
    assert.equal(r.result.airport.name, "San Francisco Intl");
    assert.equal(r.result.airport.city, "San Francisco, CA");
    assert.equal(r.result.airport.lat, 37.6189);
    assert.equal(r.result.airport.runways.length, 2);
    assert.equal(r.result.airport.frequencies.tower, "120.5");
    assert.deepEqual(r.result.airport.fuel, ["100LL", "JetA"]);
    assert.equal(callCount, 3); // airport + freq + runways
  });

  it("returns not-found when FAA database has no records for ident", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({}),
    });
    const r = await call("airport-lookup", ctxA, { ident: "ZZZZ" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found in FAA database/);
  });

  it("case-insensitive ident match", async () => {
    globalThis.fetch = async (url) => {
      // Verify the ident in the URL was upper-cased
      assert.match(url, /apt=KSFO/);
      return { ok: true, json: async () => ({ KSFO: [{ facility_name: "San Francisco Intl" }] }) };
    };
    const r = await call("airport-lookup", ctxA, { ident: "ksfo" });
    assert.equal(r.ok, true);
  });
});

describe("aviation — weather", () => {
  it("metar rejects missing ids", async () => {
    const r = await call("weather-metar", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /ids required/);
  });

  it("metar accepts array or comma string", async () => {
    // Both should pass validation; network will fail since fetch is mocked.
    const r1 = await call("weather-metar", ctxA, { ids: ["KSFO"] });
    const r2 = await call("weather-metar", ctxA, { ids: "KSFO,KLAX" });
    assert.equal(r1.ok, false); // network mocked
    assert.equal(r2.ok, false); // network mocked
    // But the error should be from fetch, not validation
    assert.doesNotMatch(r1.error, /ids required/);
    assert.doesNotMatch(r2.error, /ids required/);
  });

  it("taf rejects missing ids", async () => {
    const r = await call("weather-taf", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /ids required/);
  });
});

describe("aviation — performance calculators", () => {
  it("takeoff at sea level standard day produces sensible result", () => {
    const r = call("perf-takeoff", ctxA, { pressureAlt: 0, oat: 15, weight: 2200, headwind: 0, slope: 0 });
    assert.equal(r.ok, true);
    assert.ok(r.result.groundRoll_ft > 500 && r.result.groundRoll_ft < 1500);
    assert.ok(r.result.over50ft_ft > r.result.groundRoll_ft);
  });

  it("takeoff at high density altitude requires longer ground roll", () => {
    const sea = call("perf-takeoff", ctxA, { pressureAlt: 0, oat: 15, weight: 2200 });
    const high = call("perf-takeoff", ctxA, { pressureAlt: 8000, oat: 30, weight: 2200 });
    assert.ok(high.result.groundRoll_ft > sea.result.groundRoll_ft);
  });

  it("rejects out-of-range weight", () => {
    const r = call("perf-takeoff", ctxA, { weight: 3000 });
    assert.equal(r.ok, false);
    assert.match(r.error, /weight/);
  });

  it("landing at gross weight produces sensible result", () => {
    const r = call("perf-landing", ctxA, { pressureAlt: 0, oat: 15, weight: 2400 });
    assert.equal(r.ok, true);
    assert.ok(r.result.groundRoll_ft > 200 && r.result.groundRoll_ft < 1500);
  });

  it("headwind shortens takeoff roll", () => {
    const calm = call("perf-takeoff", ctxA, { headwind: 0, weight: 2200 });
    const headwind = call("perf-takeoff", ctxA, { headwind: 15, weight: 2200 });
    assert.ok(headwind.result.groundRoll_ft < calm.result.groundRoll_ft);
  });
});

describe("aviation — flight plans", () => {
  // Mock aviationapi.com response for great-circle distance lookup
  function mockAirports() {
    globalThis.fetch = async (url) => {
      if (url.includes("apt=KSFO")) return { ok: true, json: async () => ({ KSFO: [{ latitude_decimal: 37.6189, longitude_decimal: -122.375 }] }) };
      if (url.includes("apt=KLAX")) return { ok: true, json: async () => ({ KLAX: [{ latitude_decimal: 33.9425, longitude_decimal: -118.4081 }] }) };
      return { ok: true, json: async () => ({}) };
    };
  }

  it("creates a plan with auto-computed distance + ETE from aviationapi.com", async () => {
    mockAirports();
    const r = await call("plan-create", ctxA, { from: "KSFO", to: "KLAX", altitude: 7500, tas: 110 });
    assert.equal(r.ok, true);
    assert.ok(r.result.plan.distance_nm > 200 && r.result.plan.distance_nm < 400);
    assert.ok(r.result.plan.ete_minutes > 0);
    assert.equal(r.result.plan.from, "KSFO");
    assert.equal(r.result.plan.to, "KLAX");
  });

  it("rejects missing from/to", async () => {
    const r = await call("plan-create", ctxA, { from: "", to: "KLAX" });
    assert.equal(r.ok, false);
    assert.match(r.error, /from and to required/);
  });

  it("rejects out-of-range altitude", async () => {
    const r = await call("plan-create", ctxA, { from: "KSFO", to: "KLAX", altitude: 60000 });
    assert.equal(r.ok, false);
    assert.match(r.error, /altitude/);
  });

  it("INVARIANT: plans scoped per-user", async () => {
    mockAirports();
    await call("plan-create", ctxA, { from: "KSFO", to: "KLAX" });
    const b = call("plan-list", ctxB);
    assert.equal(b.result.plans.length, 0);
  });

  it("computes fuel burn estimate when ETE known", async () => {
    mockAirports();
    const r = await call("plan-create", ctxA, { from: "KSFO", to: "KLAX", tas: 110 });
    assert.ok(r.result.plan.estFuelBurn_gal > 0);
  });

  it("delete removes plan", async () => {
    mockAirports();
    const c = await call("plan-create", ctxA, { from: "KSFO", to: "KLAX" });
    call("plan-delete", ctxA, { id: c.result.plan.id });
    const l = call("plan-list", ctxA);
    assert.equal(l.result.plans.length, 0);
  });

  it("leaves distance null when airport lookup fails (graceful degrade)", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
    const r = await call("plan-create", ctxA, { from: "KZZZ", to: "KYYY" });
    assert.equal(r.ok, true);
    assert.equal(r.result.plan.distance_nm, null);
    assert.equal(r.result.plan.ete_minutes, null);
  });
});

describe("aviation — STATE unavailable path", () => {
  it("returns error shape when STATE is missing", () => {
    globalThis._concordSTATE = undefined;
    const r = call("plan-list", ctxA);
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});
