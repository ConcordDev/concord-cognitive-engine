// Behavioral macro tests for server/domains/astronomy.js — the Stellarium /
// SkySafari-shaped sky-observation substrate the /lenses/astronomy lens drives.
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150):
// handlers registered via `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG convention,
// with `virtualArtifact.data = input`. Our harness therefore calls
// `fn(ctx, virtualArtifact, input)`, so a regression that confuses param
// positions surfaces here.
//
// These are NOT shape-only assertions and they DO NOT duplicate the two
// existing parity suites (astronomy-domain-parity / astronomy-skywatch-domain-
// parity). They pin ACTUAL ephemeris/orbital math for KNOWN inputs → KNOWN
// outputs (sky position, moon phase/illumination, Kepler period, light-travel,
// angular separation, visibility ranking), validation-rejection, graceful
// degradation when STATE is unavailable, and a fail-CLOSED poisoned-numeric
// contract: Infinity/NaN/1e308 inputs to the pure-compute macros are REJECTED
// rather than leaking Infinity/NaN into the result. External-IO macros are
// asserted to validate+reject bad input WITHOUT performing a network call.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAstronomyActions from "../domains/astronomy.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "astronomy", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch exactly: handler(ctx, virtualArtifact, input) with
// virtualArtifact.data = input (server.js:39150).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`astronomy.${name} not registered`);
  const virtualArtifact = { id: null, title: null, domain: "astronomy", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerAstronomyActions(registerLensAction); });

let fetchCalls = 0;
beforeEach(() => {
  // No boot, no network, no LLM. Any handler that reaches for the network in
  // a test marks itself as a leak via fetchCalls.
  fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error("network disabled in tests"); };
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

// A fixed instant so all ephemeris assertions are deterministic.
const WHEN = "2026-06-21T22:00:00Z";

describe("astronomy — registration (every lens-driven macro present)", () => {
  it("registers the deterministic compute macros the lens components call", () => {
    for (const m of [
      // SkyChartWorkbench + AstronomySkySection + ActionPanel pure-compute path
      "celestialPosition", "lightTravelTime", "orbitalMechanics", "planObservation",
      "sky-chart", "whats-up", "constellations", "ephemeris-calendar", "ar-resolve",
      "catalog-list", "catalog-import",
      // GoTo + state CRUD the panels drive
      "goto-mount-set", "goto-command", "goto-queue", "astro-dashboard",
      "target-add", "target-list",
      // external-IO (driven by NasaLivePanel / IssPassPanel via NASA APIs)
      "apod", "iss-current-location", "near-earth-objects", "observing-forecast",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing astronomy.${m}`);
    }
  });
});

describe("astronomy.sky-chart — real ephemeris for a known observer/instant", () => {
  it("computes alt/az for every bright star + Sun + Moon and a sane moon phase", () => {
    const r = call("sky-chart", ctxA, { latitude: 40.7, longitude: -74.0, when: WHEN });
    assert.equal(r.ok, true);
    const res = r.result;

    // Observer echoed back exactly.
    assert.deepEqual(res.observer, { latitude: 40.7, longitude: -74.0 });
    assert.equal(res.when, new Date(WHEN).toISOString());

    // Sidereal time is a real angle in [0,360).
    assert.ok(res.siderealTimeDeg >= 0 && res.siderealTimeDeg < 360);
    assert.equal(res.siderealTimeDeg, 166.11); // pinned from the Meeus GMST math

    // All 30 catalogued bright stars are present with finite alt/az.
    assert.equal(res.stars.length, 30);
    for (const s of res.stars) {
      assert.ok(Number.isFinite(s.altitude) && s.altitude >= -90 && s.altitude <= 90, `${s.name} altitude`);
      assert.ok(Number.isFinite(s.azimuth) && s.azimuth >= 0 && s.azimuth < 360, `${s.name} azimuth`);
      assert.equal(s.visible, s.altitude > 0);
    }

    // Vega, at this instant for this observer, computes to a specific position.
    const vega = res.stars.find((s) => s.name === "Vega");
    assert.equal(vega.altitude, 10.16);
    assert.equal(vega.azimuth, 46.74);
    assert.equal(vega.visible, true);

    // Moon illumination in [0,1], phase from the canonical 8-name table.
    assert.ok(res.moon.illumination >= 0 && res.moon.illumination <= 1);
    assert.equal(res.moon.illumination, 0.502);
    assert.equal(res.moon.phase, "First Quarter");

    // Sun above horizon at 22:00 UTC over NYC midsummer ⇒ daytime flag set.
    assert.equal(res.sun.isDaytime, res.sun.altitude > -0.833);
    assert.equal(res.sun.isDaytime, true);

    // visibleCount equals the number of above-horizon stars (cross-check).
    assert.equal(res.visibleCount, res.stars.filter((s) => s.visible).length);
    assert.equal(res.visibleCount, 24);
  });

  it("rejects a missing observer (no lat/lon) — validation-rejection", () => {
    const r = call("sky-chart", ctxA, { when: WHEN });
    assert.equal(r.ok, false);
    assert.match(r.error, /latitude and longitude required/);
  });

  it("fail-CLOSED: poisoned 1e308 observer coords are clamped, NEVER emit NaN", () => {
    const r = call("sky-chart", ctxA, { latitude: 1e308, longitude: 1e308, when: WHEN });
    assert.equal(r.ok, true);
    // parseObserver clamps to the physical [-90,90]/[-180,180] envelope.
    assert.deepEqual(r.result.observer, { latitude: 90, longitude: 180 });
    assert.ok(!r.result.stars.some((s) => Number.isNaN(s.altitude)), "no NaN altitudes leaked");
    assert.ok(!r.result.stars.some((s) => Number.isNaN(s.azimuth)), "no NaN azimuths leaked");
  });
});

describe("astronomy.celestialPosition — alt/az from RA/Dec", () => {
  it("computes a real altitude for Vega over NYC (above horizon)", () => {
    const r = call("celestialPosition", ctxA, {
      rightAscension: 18.615, declination: 38.78, latitude: 40.7, longitude: -74, name: "Vega",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.object, "Vega");
    assert.ok(Number.isFinite(r.result.altitude));
    assert.ok(Number.isFinite(r.result.azimuth) && r.result.azimuth >= 0 && r.result.azimuth < 360);
    assert.equal(r.result.visible, r.result.altitude > 0);
    // bestViewing is a pure function of altitude.
    const a = r.result.altitude;
    const expected = a > 30 ? "excellent" : a > 15 ? "good" : a > 0 ? "low-on-horizon" : "below-horizon";
    assert.equal(r.result.bestViewing, expected);
  });

  it("fail-CLOSED: a 1e308 RA is rejected, never returns NaN altitude", () => {
    const r = call("celestialPosition", ctxA, { rightAscension: "1e308", declination: 1, latitude: 40, longitude: -74 });
    assert.equal(r.ok, false);
    assert.match(r.error, /finite/);
  });

  it("fail-CLOSED: Infinity latitude is rejected", () => {
    const r = call("celestialPosition", ctxA, { rightAscension: 6, declination: 10, latitude: Infinity, longitude: -74 });
    assert.equal(r.ok, false);
  });
});

describe("astronomy.orbitalMechanics — Kepler's third law", () => {
  it("Earth (a=1 AU, M=1 Msun) ⇒ period ≈ 1 year, circular orbit", () => {
    const r = call("orbitalMechanics", ctxA, { semiMajorAxis: 1, eccentricity: 0.0167, centralMass: 1, name: "Earth" });
    assert.equal(r.ok, true);
    assert.equal(r.result.periodYears, 1);          // sqrt(1^3/1) = 1
    assert.equal(r.result.periodDays, 365.3);       // 1 * 365.25 rounded
    assert.equal(r.result.perihelionAU, 0.983);     // a(1-e)
    assert.equal(r.result.aphelionAU, 1.017);       // a(1+e)
    assert.equal(r.result.avgOrbitalVelocityKmS, 29.8); // 29.78/sqrt(1)
    assert.equal(r.result.orbitType, "nearly-circular");
  });

  it("Jupiter-like a=5.2 AU ⇒ period ≈ 11.86 years", () => {
    const r = call("orbitalMechanics", ctxA, { semiMajorAxis: 5.2, eccentricity: 0.0489, centralMass: 1 });
    assert.equal(r.ok, true);
    // sqrt(5.2^3) = 11.8585...
    assert.ok(Math.abs(r.result.periodYears - 11.858) < 0.01, `got ${r.result.periodYears}`);
  });

  it("high eccentricity is classified highly-eccentric", () => {
    const r = call("orbitalMechanics", ctxA, { semiMajorAxis: 17.8, eccentricity: 0.967, centralMass: 1 }); // Halley-ish
    assert.equal(r.ok, true);
    assert.equal(r.result.orbitType, "highly-eccentric");
  });

  it("fail-CLOSED: poisoned numerics (Infinity / 0 mass) are rejected, never emit Infinity/NaN", () => {
    const r = call("orbitalMechanics", ctxA, { semiMajorAxis: "Infinity", eccentricity: "1e308", centralMass: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /finite/);
  });

  it("degrade-graceful: empty input falls back to a=1/M=1 ⇒ period 1 (defaults documented)", () => {
    const r = call("orbitalMechanics", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.periodYears, 1);
  });
});

describe("astronomy.lightTravelTime — distance ⇒ lookback", () => {
  it("Alpha Centauri 4.367 ly ⇒ parsec conversion + lookback prose", () => {
    const r = call("lightTravelTime", ctxA, { distanceLightYears: 4.367, name: "Alpha Centauri" });
    assert.equal(r.ok, true);
    assert.equal(r.result.distanceLightYears, 4.367);
    assert.equal(r.result.distanceParsecs, 1.339); // 4.367/3.2616
    assert.match(r.result.lookbackTime, /4\.37 years/);
  });

  it("parsec input converts to light-years (10 pc ⇒ 32.616 ly)", () => {
    const r = call("lightTravelTime", ctxA, { distanceParsecs: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.distanceLightYears, 32.616);
  });

  it("cosmological-but-finite distance is preserved (13.8 Gly)", () => {
    const r = call("lightTravelTime", ctxA, { distanceLightYears: 13800000000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.distanceLightYears, 13800000000);
  });

  it("fail-CLOSED: 1e308 ly is rejected, never emits Infinity km", () => {
    const r = call("lightTravelTime", ctxA, { distanceLightYears: "1e308" });
    assert.equal(r.ok, false);
    assert.match(r.error, /finite/);
  });

  it("no distance given ⇒ a guidance message, not a crash", () => {
    const r = call("lightTravelTime", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Provide distance/);
  });
});

describe("astronomy.ephemeris-calendar — rise/set + moon phase span", () => {
  it("produces one calendar row per day with finite ISO rise/set + phase", () => {
    const r = call("ephemeris-calendar", ctxA, { latitude: 40.7, longitude: -74.0, startDate: "2026-06-21", days: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 3);
    assert.equal(r.result.calendar.length, 3);
    const d0 = r.result.calendar[0];
    assert.equal(d0.date, "2026-06-21");
    assert.equal(d0.moonPhase, "First Quarter");
    assert.ok(d0.moonIllumination >= 0 && d0.moonIllumination <= 1);
    // Sun rises and sets over NYC midsummer — both timestamps are real ISO.
    assert.match(d0.sunrise, /^2026-06-21T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.match(d0.sunset, /^2026-06-21T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("clamps the observer envelope (lat 91 ⇒ 90) — never out-of-range", () => {
    const r = call("ephemeris-calendar", ctxA, { latitude: 91, longitude: 200, startDate: "2026-06-21", days: 1 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.observer, { latitude: 90, longitude: 180 });
  });

  it("rejects a malformed startDate — validation-rejection", () => {
    const r = call("ephemeris-calendar", ctxA, { latitude: 40, longitude: -74, startDate: "notadate" });
    assert.equal(r.ok, false);
    assert.match(r.error, /YYYY-MM-DD/);
  });

  it("rejects a missing observer", () => {
    const r = call("ephemeris-calendar", ctxA, { startDate: "2026-06-21" });
    assert.equal(r.ok, false);
    assert.match(r.error, /latitude and longitude required/);
  });
});

describe("astronomy.whats-up — visibility ranking by altitude", () => {
  it("returns objects above minAltitude, sorted high→low, with a real best", () => {
    const r = call("whats-up", ctxA, { latitude: 40.7, longitude: -74.0, when: WHEN, minAltitude: 20 });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1);
    // Every object clears the threshold.
    for (const o of r.result.objects) assert.ok(o.altitude >= 20, `${o.name} ${o.altitude}`);
    // Sorted descending by altitude.
    for (let i = 1; i < r.result.objects.length; i++) {
      assert.ok(r.result.objects[i - 1].altitude >= r.result.objects[i].altitude, "not sorted desc");
    }
    assert.equal(r.result.best, r.result.objects[0]);
    // darkSky is a pure function of the Sun's altitude.
    assert.equal(r.result.darkSky, r.result.sunAltitude < -12);
  });

  it("rejects a missing observer", () => {
    const r = call("whats-up", ctxA, { when: WHEN });
    assert.equal(r.ok, false);
    assert.match(r.error, /latitude and longitude required/);
  });
});

describe("astronomy.constellations + catalog — topology + filters", () => {
  it("returns stick-figure topology with J2000 endpoints + the Messier catalogue", () => {
    const r = call("constellations", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 3);            // Orion, Ursa Major, Gemini
    assert.equal(r.result.deepSkyCount, 16);    // built-in Messier set
    const orion = r.result.constellations.find((c) => c.name === "Orion");
    assert.ok(orion);
    // Every segment endpoint resolves to a real catalogued star (no nulls).
    for (const seg of orion.segments) {
      assert.ok(seg.fromRaDec && Number.isFinite(seg.fromRaDec.ra), `${seg.from} unresolved`);
      assert.ok(seg.toRaDec && Number.isFinite(seg.toRaDec.dec), `${seg.to} unresolved`);
    }
  });

  it("catalog-list filters by type + maxMagnitude and sorts by brightness", () => {
    const r = call("catalog-list", ctxA, { type: "galaxy", maxMagnitude: 7 });
    assert.equal(r.ok, true);
    // Only galaxies with mag <= 7: M31 (3.4) and M81 (6.9).
    assert.deepEqual(r.result.catalog.map((x) => x.id).sort(), ["M31", "M81"]);
    assert.ok(r.result.catalog.every((x) => x.type === "galaxy" && x.magnitude <= 7));
    // Sorted brightest-first.
    assert.equal(r.result.catalog[0].id, "M31");
  });
});

describe("astronomy.ar-resolve — angular separation match", () => {
  it("pointing exactly at a star's alt/az resolves that star with ~0° separation", () => {
    const sky = call("sky-chart", ctxA, { latitude: 40.7, longitude: -74.0, when: WHEN });
    const vega = sky.result.stars.find((s) => s.name === "Vega");
    const r = call("ar-resolve", ctxA, {
      latitude: 40.7, longitude: -74.0, altitude: vega.altitude, azimuth: vega.azimuth, when: WHEN, fov: 10,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.nearest.name, "Vega");
    assert.ok(r.result.nearest.separationDeg <= 1, `sep ${r.result.nearest.separationDeg}`);
  });

  it("rejects a missing pointing direction (no alt/az)", () => {
    const r = call("ar-resolve", ctxA, { latitude: 40.7, longitude: -74.0, when: WHEN });
    assert.equal(r.ok, false);
    assert.match(r.error, /altitude and azimuth/);
  });
});

describe("astronomy.goto-command — alt/az resolution + state", () => {
  it("resolves alt/az for a target with observer coords and queues it", () => {
    const r = call("goto-command", ctxA, { targetName: "Vega", ra: 279.234, dec: 38.784, latitude: 40.7, longitude: -74.0 });
    assert.equal(r.ok, true);
    assert.equal(r.result.command.targetName, "Vega");
    assert.ok(r.result.command.altAz && Number.isFinite(r.result.command.altAz.altitude));
    // No mount configured ⇒ status reflects that, command still queued in state.
    assert.equal(r.result.command.status, "no-mount");
    const q = call("goto-queue", ctxA, {});
    assert.equal(q.result.count, 1);
  });

  it("rejects a missing targetName / non-finite ra-dec — validation-rejection", () => {
    assert.equal(call("goto-command", ctxA, { ra: 1, dec: 1 }).ok, false);
    assert.equal(call("goto-command", ctxA, { targetName: "X", ra: "nope", dec: 1 }).ok, false);
  });
});

describe("astronomy — degrade-graceful when STATE is unavailable", () => {
  it("state-backed macros return ok:false instead of throwing", () => {
    globalThis._concordSTATE = undefined;
    for (const m of ["target-add", "target-list", "astro-dashboard", "goto-queue", "session-list"]) {
      const r = call(m, ctxA, { name: "x" });
      assert.equal(r.ok, false, `${m} should fail-soft`);
      assert.match(r.error, /STATE unavailable/);
    }
  });

  it("pure-math macros still work with no STATE (they don't touch it)", () => {
    globalThis._concordSTATE = undefined;
    const r = call("orbitalMechanics", ctxA, { semiMajorAxis: 1, centralMass: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.periodYears, 1);
  });
});

describe("astronomy — external-IO macros validate WITHOUT a network call", () => {
  it("near-earth-objects rejects a malformed date before fetching", async () => {
    const r = await call("near-earth-objects", ctxA, { startDate: "xx" });
    assert.equal(r.ok, false);
    assert.match(r.error, /YYYY-MM-DD/);
    assert.equal(fetchCalls, 0, "no network call on validation failure");
  });

  it("observing-forecast rejects a missing observer before fetching", async () => {
    const r = await call("observing-forecast", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /latitude and longitude required/);
    assert.equal(fetchCalls, 0, "no network call on validation failure");
  });

  it("apod degrades to ok:false when the network is down (never throws)", async () => {
    const r = await call("apod", ctxA, { date: "2026-06-21" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/);
    assert.ok(fetchCalls >= 1, "apod did attempt the fetch (then failed soft)");
  });

  it("iss-current-location degrades to ok:false when the network is down", async () => {
    const r = await call("iss-current-location", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/);
  });
});
