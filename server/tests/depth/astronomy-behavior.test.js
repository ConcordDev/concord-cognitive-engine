// tests/depth/astronomy-behavior.test.js — REAL behavioral tests for the
// `astronomy` domain (Stellarium/SkySafari-parity sky lens; registerLensAction
// family, invoked via lensRun). Exact-value assertions on the deterministic
// ephemeris + orbital-mechanics math (Kepler's third law, light-travel time,
// fixed-date sky-chart alt/az + moon phase, whats-up ranking, ephemeris
// calendar, Messier catalog filtering) + observing-target / observation-log /
// session CRUD round-trips + validation rejections.
//
// SKIPPED — network macros that fail under no-egress: `apod` (NASA APOD),
// `iss-current-location` (wheretheiss.at), `near-earth-objects` (NASA NeoWs),
// `feed` (NASA APOD batch), `observing-forecast` (Open-Meteo). Also SKIPPED:
// `celestialPosition` / `planObservation` read `new Date()` internally (no
// `when` param) so they are not date-deterministic — the deterministic sky math
// is fully covered by `sky-chart` / `whats-up` / `ephemeris-calendar` which DO
// accept a fixed `when`/`startDate`.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("astronomy — orbital mechanics + distance math (exact values)", () => {
  it("orbitalMechanics: Kepler T²=a³/M (a=4 AU, M=1 → 8 yr), peri/aph, eccentric class", async () => {
    const r = await lensRun("astronomy", "orbitalMechanics", {
      data: { semiMajorAxis: 4, eccentricity: 0.5, centralMass: 1, name: "Test Body" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.periodYears, 8);          // sqrt(4^3 / 1) = 8
    assert.equal(r.result.periodDays, 2922);        // 8 * 365.25
    assert.equal(r.result.perihelionAU, 2);         // 4 * (1 - 0.5)
    assert.equal(r.result.aphelionAU, 6);           // 4 * (1 + 0.5)
    assert.equal(r.result.avgOrbitalVelocityKmS, 14.9); // 29.78 / sqrt(4)
    assert.equal(r.result.orbitType, "highly-eccentric"); // e=0.5 is not < 0.5
  });

  it("orbitalMechanics: a nearly-circular low-e orbit is classified nearly-circular", async () => {
    const r = await lensRun("astronomy", "orbitalMechanics", {
      data: { semiMajorAxis: 1, eccentricity: 0.0167, centralMass: 1 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.periodYears, 1);          // Earth: 1 AU, 1 solar mass → 1 yr
    assert.equal(r.result.orbitType, "nearly-circular"); // e < 0.05
  });

  it("lightTravelTime: 4.246 ly → parsec conversion + lookback prose", async () => {
    const r = await lensRun("astronomy", "lightTravelTime", {
      data: { distanceLightYears: 4.246, name: "Proxima Centauri" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.distanceLightYears, 4.246);
    assert.equal(r.result.distanceParsecs, 1.302); // 4.246 / 3.2616
    assert.equal(r.result.distanceKm, "4.017e+13");
    assert.equal(r.result.travelTimeLight, "4.25 years"); // round(4.246*100)/100
    assert.ok(r.result.lookbackTime.includes("4.25 years ago"));
  });

  it("lightTravelTime: parsecs input converts to light-years (1 pc → 3.262 ly)", async () => {
    const r = await lensRun("astronomy", "lightTravelTime", {
      data: { distanceParsecs: 1 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.distanceLightYears, 3.262); // 1 * 3.2616 rounded to 3 dp
  });

  it("lightTravelTime: no distance given returns a guidance message, not a number", async () => {
    const r = await lensRun("astronomy", "lightTravelTime", { data: {} });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("light-years"));
  });
});

describe("astronomy — fixed-date ephemeris (deterministic alt/az + moon phase)", () => {
  // Polaris altitude ≈ observer latitude is a robust physics invariant of the
  // equatorial→horizontal transform, independent of sidereal time.
  it("sky-chart: Polaris altitude ≈ observer latitude (NYC 40.7°N, fixed when)", async () => {
    const r = await lensRun("astronomy", "sky-chart", {
      params: { latitude: 40.7, longitude: -74.0, when: "2026-03-20T04:00:00Z" },
    });
    assert.equal(r.ok, true);
    const polaris = r.result.stars.find((s) => s.name === "Polaris");
    assert.ok(polaris, "Polaris present in star list");
    assert.equal(polaris.altitude, 40.27); // ≈ latitude
    assert.equal(polaris.visible, true);
    assert.equal(r.result.constellationLines.length, 3); // Orion, Big Dipper, Gemini
  });

  it("sky-chart: moon phase + Sun daytime flag are computed for a fixed instant", async () => {
    const r = await lensRun("astronomy", "sky-chart", {
      params: { latitude: 40.7, longitude: -74.0, when: "2026-01-15T22:00:00Z" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.moon.phase, "Waning Crescent");
    assert.equal(r.result.moon.illumination, 0.081);
    assert.equal(r.result.sun.isDaytime, false); // sun alt -1.94 < -0.833
    assert.equal(r.result.siderealTimeDeg, 11.36);
  });

  it("whats-up: ranks objects above minAltitude, highest first (Polaris visible)", async () => {
    const r = await lensRun("astronomy", "whats-up", {
      params: { latitude: 40.7, longitude: -74.0, when: "2026-03-20T04:00:00Z", minAltitude: 10 },
    });
    assert.equal(r.ok, true);
    // Sorted descending by altitude — first object is the highest.
    for (let i = 1; i < r.result.objects.length; i++) {
      assert.ok(r.result.objects[i - 1].altitude >= r.result.objects[i].altitude);
    }
    assert.ok(r.result.objects.every((o) => o.altitude >= 10));
    assert.ok(r.result.objects.some((o) => o.name === "Polaris"));
    assert.equal(r.result.best, r.result.objects[0]);
  });

  it("ephemeris-calendar: fixed startDate gives deterministic moon phase per day", async () => {
    const r = await lensRun("astronomy", "ephemeris-calendar", {
      params: { latitude: 40.7, longitude: -74.0, startDate: "2026-01-15", days: 3 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 3);
    assert.equal(r.result.calendar[0].date, "2026-01-15");
    assert.equal(r.result.calendar[0].moonPhase, "Waning Crescent");
    assert.equal(r.result.calendar[0].moonIllumination, 0.104); // moon at noon
  });

  it("sky-chart: missing latitude/longitude is rejected", async () => {
    const r = await lensRun("astronomy", "sky-chart", { params: { latitude: 40.7 } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /latitude and longitude required/);
  });
});

describe("astronomy — Messier catalog filtering (exact)", () => {
  it("catalog-list filters by type and sorts by magnitude ascending", async () => {
    const r = await lensRun("astronomy", "catalog-list", { params: { type: "galaxy" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 6); // M31, M51, M63, M81, M101, M104
    assert.ok(r.result.catalog.every((c) => c.type === "galaxy"));
    for (let i = 1; i < r.result.catalog.length; i++) {
      assert.ok(r.result.catalog[i - 1].magnitude <= r.result.catalog[i].magnitude);
    }
  });

  it("catalog-list maxMagnitude keeps only bright objects (mag <= 4 → M45 brightest)", async () => {
    const r = await lensRun("astronomy", "catalog-list", { params: { maxMagnitude: 4.0 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 4); // M45, M31, M44, M42
    assert.ok(r.result.catalog.every((c) => c.magnitude <= 4.0));
    assert.equal(r.result.catalog[0].id, "M45"); // brightest (mag 1.6) sorts first
  });
});

describe("astronomy — observing-target + log + session CRUD round-trips", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`astronomy-crud-${randomUUID()}`); });

  it("target-add → target-list → catalog-import → observation-log round-trip", async () => {
    const added = await lensRun("astronomy", "target-add", {
      params: { name: "My Comet", type: "comet", constellation: "Leo", magnitude: 7.2 },
    }, ctx);
    assert.equal(added.ok, true);
    const targetId = added.result.target.id;
    assert.equal(added.result.target.type, "comet");

    const list = await lensRun("astronomy", "target-list", {}, ctx);
    assert.ok(list.result.targets.some((t) => t.id === targetId));

    // Import a real Messier object as a target, then log an observation on it.
    const imported = await lensRun("astronomy", "catalog-import", { params: { catalogId: "M31" } }, ctx);
    assert.equal(imported.ok, true);
    assert.ok(imported.result.target.name.includes("Andromeda Galaxy"));
    const m31Id = imported.result.target.id;

    const logged = await lensRun("astronomy", "observation-log", {
      params: { targetId: m31Id, conditions: "clear", rating: 5, notes: "naked eye smudge" },
    }, ctx);
    assert.equal(logged.ok, true);
    assert.equal(logged.result.observation.rating, 5);
    assert.equal(logged.result.observation.targetName, imported.result.target.name);

    // The observation makes the target read back as observed with count 1.
    const detail = await lensRun("astronomy", "target-detail", { params: { id: m31Id } }, ctx);
    assert.equal(detail.result.observations.length, 1);
    const relisted = await lensRun("astronomy", "target-list", {}, ctx);
    const m31 = relisted.result.targets.find((t) => t.id === m31Id);
    assert.equal(m31.observed, true);
    assert.equal(m31.observationCount, 1);
  });

  it("rating is clamped to 0..5 (input 9 → 5)", async () => {
    const t = await lensRun("astronomy", "target-add", { params: { name: "Clamp Target" } }, ctx);
    const obs = await lensRun("astronomy", "observation-log", {
      params: { targetId: t.result.target.id, rating: 9 },
    }, ctx);
    assert.equal(obs.ok, true);
    assert.equal(obs.result.observation.rating, 5); // Math.min(5, round(9))
  });

  it("session-create clamps bortle to 1..9 and defaults seeing to a valid enum", async () => {
    const s = await lensRun("astronomy", "session-create", {
      params: { location: "Backyard", bortle: 42, seeing: "nonsense" },
    }, ctx);
    assert.equal(s.ok, true);
    assert.equal(s.result.session.bortle, 9);       // clamped from 42
    assert.equal(s.result.session.seeing, "average"); // invalid → default
  });
});

describe("astronomy — validation rejections", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`astronomy-reject-${randomUUID()}`); });

  it("target-add without a name is rejected", async () => {
    const bad = await lensRun("astronomy", "target-add", { params: {} }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /target name required/);
  });

  it("observation-log against an unknown target is rejected", async () => {
    const bad = await lensRun("astronomy", "observation-log", { params: { targetId: "nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /target not found/);
  });

  it("catalog-import of an unknown catalog id is rejected", async () => {
    const bad = await lensRun("astronomy", "catalog-import", { params: { catalogId: "M999" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /catalog object not found/);
  });
});
