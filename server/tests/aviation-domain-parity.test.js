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

// ── Full-app parity (ForeFlight + FlightAware 2026) ─────────────

describe("aviation.aircraft-*", () => {
  it("add / list / update / delete cycle, per-user scoped", () => {
    const a = call("aircraft-add", ctxA, { tail: "n12345", make: "Cessna", model: "172S", year: 2018, cruiseKts: 120, fuelBurnGph: 9 });
    assert.equal(a.ok, true);
    assert.equal(a.result.aircraft.tail, "N12345");
    assert.equal(call("aircraft-list", ctxA, {}).result.aircraft.length, 1);
    assert.equal(call("aircraft-list", ctxB, {}).result.aircraft.length, 0);
    const u = call("aircraft-update", ctxA, { id: a.result.aircraft.id, hobbsHours: 50 });
    assert.equal(u.result.aircraft.hobbsHours, 50);
    assert.equal(call("aircraft-delete", ctxA, { id: a.result.aircraft.id }).ok, true);
  });
  it("rejects missing tail/make/model", () => {
    assert.equal(call("aircraft-add", ctxA, { tail: "", make: "X", model: "Y" }).ok, false);
    assert.equal(call("aircraft-add", ctxA, { tail: "X", make: "", model: "Y" }).ok, false);
  });
});

describe("aviation.logbook-* (entries + totals)", () => {
  it("add entry, auto-rolls Hobbs on aircraft", () => {
    const ac = call("aircraft-add", ctxA, { tail: "N111", make: "Cessna", model: "172", hobbsHours: 100 });
    const e = call("logbook-add", ctxA, { aircraftId: ac.result.aircraft.id, date: "2026-05-01", from: "ksjc", to: "kpao", totalHours: 1.4, pic: 1.4, dayLandings: 2 });
    assert.equal(e.ok, true);
    assert.equal(e.result.entry.from, "KSJC");
    const acAfter = call("aircraft-list", ctxA, {}).result.aircraft[0];
    assert.equal(acAfter.hobbsHours, 101.4);
  });
  it("totals aggregates across entries", () => {
    const ac = call("aircraft-add", ctxA, { tail: "N222", make: "P", model: "M" });
    call("logbook-add", ctxA, { aircraftId: ac.result.aircraft.id, date: "2026-04-01", from: "KSJC", to: "KOAK", totalHours: 1.0, pic: 1.0, dayLandings: 1, instrument: 0.5 });
    call("logbook-add", ctxA, { aircraftId: ac.result.aircraft.id, date: "2026-04-15", from: "KOAK", to: "KSJC", totalHours: 1.2, pic: 1.2, night: 0.4, nightLandings: 1, approaches: [{ type: "ILS", airport: "KSJC" }] });
    const t = call("logbook-totals", ctxA, {});
    assert.equal(t.result.totalHours, 2.2);
    assert.equal(t.result.pic, 2.2);
    assert.equal(t.result.night, 0.4);
    assert.equal(t.result.totalFlights, 2);
    assert.equal(t.result.totalLandings, 2);
    assert.equal(t.result.nightLandings, 1);
  });
  it("rejects bad input", () => {
    assert.equal(call("logbook-add", ctxA, { aircraftId: "", date: "x", from: "y", to: "z", totalHours: 1 }).ok, false);
    const ac = call("aircraft-add", ctxA, { tail: "N333", make: "P", model: "M" });
    assert.equal(call("logbook-add", ctxA, { aircraftId: ac.result.aircraft.id, date: "2026-01-01", from: "X", to: "Y", totalHours: 0 }).ok, false);
  });
});

describe("aviation.currency-* (BFR / medical / 90-day / IFR)", () => {
  it("BFR within 24 months is current", () => {
    call("currency-event-add", ctxA, { kind: "flight_review", date: new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10) });
    const r = call("currency-status", ctxA, {});
    assert.equal(r.result.bfr.current, true);
    assert.ok(r.result.bfr.expiresInDays > 600);
  });
  it("BFR beyond 24 months is not current", () => {
    call("currency-event-add", ctxA, { kind: "flight_review", date: new Date(Date.now() - 800 * 86400000).toISOString().slice(0, 10) });
    const r = call("currency-status", ctxA, {});
    assert.equal(r.result.bfr.current, false);
  });
  it("90-day passenger-carrying requires 3 landings", () => {
    const ac = call("aircraft-add", ctxA, { tail: "N444", make: "P", model: "M" });
    call("logbook-add", ctxA, { aircraftId: ac.result.aircraft.id, date: new Date().toISOString().slice(0, 10), from: "A", to: "B", totalHours: 1, dayLandings: 3 });
    const r = call("currency-status", ctxA, {});
    assert.equal(r.result.passenger90.dayCurrent, true);
    assert.equal(r.result.passenger90.dayCount, 3);
  });
  it("rejects bad kind", () => {
    assert.equal(call("currency-event-add", ctxA, { kind: "bogus" }).ok, false);
  });
});

describe("aviation.track-logs-* (recorded flights)", () => {
  it("start / append points / end cycle with distance calc", () => {
    const ac = call("aircraft-add", ctxA, { tail: "N555", make: "P", model: "M" });
    const t = call("track-logs-start", ctxA, { aircraftId: ac.result.aircraft.id, from: "KSJC", to: "KMRY" });
    assert.equal(t.ok, true);
    call("track-logs-append", ctxA, { trackId: t.result.track.id, lat: 37.36, lng: -121.92, altitudeFt: 1500, groundSpeedKts: 100 });
    call("track-logs-append", ctxA, { trackId: t.result.track.id, lat: 37.00, lng: -121.85, altitudeFt: 4500, groundSpeedKts: 120 });
    call("track-logs-append", ctxA, { trackId: t.result.track.id, lat: 36.59, lng: -121.84, altitudeFt: 4500, groundSpeedKts: 120 });
    const ended = call("track-logs-end", ctxA, { trackId: t.result.track.id });
    assert.equal(ended.ok, true);
    assert.ok(ended.result.track.totalDistanceNm > 30);
    assert.equal(ended.result.track.maxAltitudeFt, 4500);
  });
  it("double-start same aircraft rejected", () => {
    const ac = call("aircraft-add", ctxA, { tail: "N666", make: "P", model: "M" });
    call("track-logs-start", ctxA, { aircraftId: ac.result.aircraft.id });
    assert.equal(call("track-logs-start", ctxA, { aircraftId: ac.result.aircraft.id }).ok, false);
  });
});

describe("aviation.briefing-graphical + notams-fetch (real APIs)", () => {
  it("briefing rejects missing icaos", async () => {
    const r = await call("briefing-graphical", ctxA, {});
    assert.equal(r.ok, false);
  });
  it("notams returns config error when key missing", async () => {
    delete process.env.FAA_NOTAM_API_KEY;
    const r = await call("notams-fetch", ctxA, { icao: "KSJC" });
    assert.equal(r.ok, false);
    assert.match(r.error, /FAA_NOTAM_API_KEY/);
  });
});

describe("aviation.route-advisor (suggest from logbook history)", () => {
  it("suggests direct route + prior-flown routes", () => {
    const ac = call("aircraft-add", ctxA, { tail: "N777", make: "P", model: "M" });
    call("logbook-add", ctxA, { aircraftId: ac.result.aircraft.id, date: "2026-04-01", from: "KSJC", to: "KMRY", totalHours: 0.8, pic: 0.8, route: ["KSJC", "WOODS", "KMRY"] });
    call("logbook-add", ctxA, { aircraftId: ac.result.aircraft.id, date: "2026-04-15", from: "KSJC", to: "KMRY", totalHours: 0.7, pic: 0.7, route: ["KSJC", "WOODS", "KMRY"] });
    const r = call("route-advisor", ctxA, { from: "ksjc", to: "kmry", altitudeFt: 6500 });
    assert.equal(r.ok, true);
    assert.equal(r.result.suggestions[0].rationale, "Direct");
    const flown = r.result.suggestions.find(s => s.flownCount === 2);
    assert.ok(flown);
    assert.deepEqual(flown.route, ["KSJC", "WOODS", "KMRY"]);
  });
  it("rejects missing from/to", () => {
    assert.equal(call("route-advisor", ctxA, { from: "", to: "X" }).ok, false);
  });
});

describe("aviation.live-flights-* (watch list)", () => {
  it("watch / list / unwatch cycle", () => {
    call("live-flights-watch", ctxA, { ident: "ual123" });
    assert.equal(call("live-flights-tracked", ctxA, {}).result.flights[0].ident, "UAL123");
    assert.equal(call("live-flights-watch", ctxA, { ident: "UAL123" }).ok, false);
    assert.equal(call("live-flights-unwatch", ctxA, { ident: "UAL123" }).ok, true);
    assert.equal(call("live-flights-tracked", ctxA, {}).result.flights.length, 0);
  });
});

describe("aviation.fuel-stops-calc", () => {
  it("computes stops + fuel + time", () => {
    const ac = call("aircraft-add", ctxA, { tail: "N888", make: "P", model: "M", cruiseKts: 120, fuelBurnGph: 9, fuelCapacityGal: 50 });
    const r = call("fuel-stops-calc", ctxA, { aircraftId: ac.result.aircraft.id, totalDistanceNm: 1000, reserveGal: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.maxLegNm, 600);
    assert.equal(r.result.fuelStopsRequired, 1);
  });
  it("rejects invalid input", () => {
    assert.equal(call("fuel-stops-calc", ctxA, { aircraftId: "nope", totalDistanceNm: 100 }).ok, false);
  });
});

describe("aviation.dashboard-summary", () => {
  it("aggregates aircraft + logbook + tracks + plans", () => {
    const ctxC = { actor: { userId: "user_av_dash" }, userId: "user_av_dash" };
    const ac = call("aircraft-add", ctxC, { tail: "N999", make: "P", model: "M" });
    call("logbook-add", ctxC, { aircraftId: ac.result.aircraft.id, date: new Date().toISOString().slice(0, 10), from: "A", to: "B", totalHours: 1.5 });
    call("logbook-add", ctxC, { aircraftId: ac.result.aircraft.id, date: new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10), from: "C", to: "D", totalHours: 2.0 });
    call("track-logs-start", ctxC, { aircraftId: ac.result.aircraft.id });
    call("live-flights-watch", ctxC, { ident: "DAL456" });
    const d = call("dashboard-summary", ctxC, {});
    assert.equal(d.result.aircraftCount, 1);
    assert.equal(d.result.totalHours, 3.5);
    assert.equal(d.result.hours30d, 1.5);
    assert.equal(d.result.totalFlights, 2);
    assert.equal(d.result.activeTracks, 1);
    assert.equal(d.result.watchedFlights, 1);
  });
});
