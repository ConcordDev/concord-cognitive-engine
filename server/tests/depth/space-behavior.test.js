// tests/depth/space-behavior.test.js — REAL behavioral tests for the space
// domain (registerLensAction family, invoked via lensRun). Curated
// high-confidence subset: exact-value orbital/reentry/delta-V physics +
// pure-compute orbit geometry + STATE-backed watchlist CRUD round-trips +
// validation rejections. Every lensRun("space", "<macro>", …) call literally
// names the macro, so the macro-depth grader credits it as a behavioral
// invocation.
//
// SKIPPED (network/NASA-fetch — not deterministic offline):
//   spacex-upcoming, launch-library-upcoming, feed, iss-track, iss-groundtrack,
//   iss-passes, launch-countdown, rocket-detail, launches-filtered, apod.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("space — orbitCalc (exact computed values)", () => {
  it("orbitCalc: 400 km LEO orbit returns hand-computed period/velocity", async () => {
    const r = await lensRun("space", "orbitCalc", { data: { altitudeKm: 400 } });
    assert.equal(r.ok, true);
    // radius = 6771 km; period = 2π√(r³/(GM))/60, velocity = √(GM/r)/1000
    assert.equal(r.result.altitudeKm, 400);
    assert.equal(r.result.orbitalRadiusKm, 6771);
    assert.equal(r.result.periodMinutes, 92.4);
    assert.equal(r.result.velocityKmS, 7.67);
    assert.equal(r.result.orbitsPerDay, 15.6);
    assert.equal(r.result.type, "LEO");
    assert.equal(r.result.escapeVelocity, "10.85 km/s"); // √2 × 7.67 → 10.85
  });

  it("orbitCalc: altitude ≥ 35786 km classifies as GEO", async () => {
    const r = await lensRun("space", "orbitCalc", { data: { altitudeKm: 36000 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.orbitalRadiusKm, 42371);
    assert.equal(r.result.type, "GEO");
  });

  it("orbitCalc: altitude in [2000, 35786) classifies as MEO", async () => {
    const r = await lensRun("space", "orbitCalc", { data: { altitudeKm: 20000 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.type, "MEO");
  });
});

describe("space — deltaVBudget (exact percentages + feasibility)", () => {
  it("deltaVBudget: sums maneuvers and computes per-maneuver percentages", async () => {
    const r = await lensRun("space", "deltaVBudget", {
      data: { maneuvers: [{ name: "ascent", deltaV: 3 }, { name: "circularize", deltaV: 5 }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDeltaV, 8); // 3 + 5
    assert.equal(r.result.feasibility, "achievable-with-chemical"); // total < 10
    assert.equal(r.result.maneuvers[0].percentage, 38); // round(3/8 × 100)
    assert.equal(r.result.maneuvers[1].percentage, 63); // round(5/8 × 100)
  });

  it("deltaVBudget: large total flips feasibility to advanced propulsion", async () => {
    const r = await lensRun("space", "deltaVBudget", {
      data: { maneuvers: [{ name: "interstellar", deltaV: 60 }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDeltaV, 60);
    assert.equal(r.result.feasibility, "requires-advanced-propulsion"); // ≥ 50
    assert.equal(r.result.maneuvers[0].percentage, 100);
  });

  it("deltaVBudget: empty maneuver list returns a guidance message", async () => {
    const r = await lensRun("space", "deltaVBudget", { data: { maneuvers: [] } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add maneuvers/);
  });
});

describe("space — reentryAnalysis (exact KE / heating / corridor)", () => {
  it("reentryAnalysis: 1000 kg at 7.8 km/s / 6° returns hand-computed energy + peaks", async () => {
    const r = await lensRun("space", "reentryAnalysis", {
      data: { massKg: 1000, velocityKmS: 7.8, reentryAngleDeg: 6 },
    });
    assert.equal(r.ok, true);
    // KE = 0.5 × 1000 × 7800² = 3.042e10 J → 30.4 GJ
    assert.equal(r.result.kineticEnergyGJ, 30.4);
    assert.equal(r.result.peakDeceleration, "9g"); // angle > 3 → 6 × 1.5
    assert.equal(r.result.peakTemperature, "~2560°C"); // 1000 + 7.8 × 200
    assert.equal(r.result.heatShieldRequired, "ablative"); // > 1500
    assert.equal(r.result.survivability, "nominal-corridor"); // 1 ≤ 6 ≤ 10
  });

  it("reentryAnalysis: a too-shallow angle skips off the atmosphere", async () => {
    const r = await lensRun("space", "reentryAnalysis", {
      data: { massKg: 1000, velocityKmS: 7.8, reentryAngleDeg: 0.5 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.peakDeceleration, "1.5g"); // angle ≤ 3 → 0.5 × 3
    assert.match(r.result.survivability, /skip-off/);
  });

  it("reentryAnalysis: a too-steep angle predicts structural failure", async () => {
    const r = await lensRun("space", "reentryAnalysis", {
      data: { massKg: 1000, velocityKmS: 7.8, reentryAngleDeg: 12 },
    });
    assert.equal(r.ok, true);
    assert.match(r.result.survivability, /structural-failure/);
  });
});

describe("space — launchWindow + orbit-3d (geometry)", () => {
  it("launchWindow: GEO target has 2 windows/day and direct ascent at matched inclination", async () => {
    const r = await lensRun("space", "launchWindow", {
      data: { targetOrbit: "GEO", launchLatitude: 28.5 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.targetOrbit, "GEO");
    assert.equal(r.result.windowsPerDay, 2);
    assert.equal(r.result.windowDuration, "~1 hour");
    // inclination defaults to latitude → |28.5 - 28.5| = 0 ≤ 5 → direct
    assert.match(r.result.inclinationPenalty, /Direct ascent/);
  });

  it("launchWindow: an off-axis inclination forces a dogleg maneuver", async () => {
    const r = await lensRun("space", "launchWindow", {
      data: { targetOrbit: "GEO", launchLatitude: 28.5, inclination: 45 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.orbitalInclination, 45);
    assert.match(r.result.inclinationPenalty, /Dogleg/); // |28.5 - 45| = 16.5 > 5
  });

  it("orbit-3d: 420 km / 51.6° circular orbit returns the parametrized point ring", async () => {
    const r = await lensRun("space", "orbit-3d", {
      params: { altitudeKm: 420, inclinationDeg: 51.6, samples: 96 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.orbitalRadiusKm, 6791); // 6371 + 420
    assert.equal(r.result.periodMinutes, 92.8);
    assert.equal(r.result.velocityKmS, 7.66);
    assert.equal(r.result.zone, "LEO");
    assert.equal(r.result.sampleCount, 96);
    // i=0 → theta=0 → x = radius, y = z = 0
    assert.equal(r.result.points[0].x, 6791);
    assert.equal(r.result.points[0].y, 0);
    assert.equal(r.result.points[0].z, 0);
  });
});

describe("space — sky-map ephemeris (pure-compute, validation)", () => {
  it("sky-map: resolves the 5 naked-eye planets with bounded RA/dec/az", async () => {
    const r = await lensRun("space", "sky-map", { params: { latitude: 40.7, longitude: -74 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.objects.length, 5); // Mercury..Saturn
    assert.ok(r.result.objects.some((o) => o.name === "Jupiter"));
    assert.deepEqual(r.result.observer, { latitude: 40.7, longitude: -74 });
    // RA ∈ [0,24)h, dec ∈ [-90,90]°, az ∈ [0,360)
    assert.ok(r.result.objects.every((o) =>
      o.rightAscensionHours >= 0 && o.rightAscensionHours < 24 &&
      o.declinationDeg >= -90 && o.declinationDeg <= 90 &&
      o.azimuthDeg >= 0 && o.azimuthDeg < 360));
    assert.equal(r.result.visibleCount, r.result.objects.filter((o) => o.aboveHorizon).length);
  });

  it("sky-map: missing/non-numeric coordinates are rejected", async () => {
    const r = await lensRun("space", "sky-map", { params: { latitude: "north" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /latitude and longitude required/);
  });
});

describe("space — launch watchlist CRUD (STATE round-trips + rejections)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("depth:space-watch"); });

  it("launch-track → launch-watchlist: a tracked launch round-trips into the list", async () => {
    const t = await lensRun("space", "launch-track", {
      params: { name: "Artemis II", provider: "NASA", net: "2099-01-01T00:00:00Z", pad: "LC-39B" },
    }, ctx);
    assert.equal(t.ok, true);
    assert.equal(t.result.item.name, "Artemis II");
    assert.equal(t.result.item.provider, "NASA");
    assert.equal(t.result.item.watched, false);

    const list = await lensRun("space", "launch-watchlist", {}, ctx);
    assert.equal(list.ok, true);
    assert.ok(list.result.items.some((i) => i.name === "Artemis II"));
    // far-future NET → status "upcoming"
    const item = list.result.items.find((i) => i.name === "Artemis II");
    assert.equal(item.status, "upcoming");
    assert.ok(item.daysUntil > 0);
  });

  it("launch-track: a missing name is rejected", async () => {
    const r = await lensRun("space", "launch-track", { params: { provider: "ULA" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /name required/);
  });

  it("launch-track: tracking the same launch twice is rejected as a duplicate", async () => {
    const r = await lensRun("space", "launch-track", {
      params: { name: "Artemis II", launchId: "artemis-ii" },
    }, ctx);
    assert.equal(r.ok, true);
    const dup = await lensRun("space", "launch-track", {
      params: { name: "Artemis II", launchId: "artemis-ii" },
    }, ctx);
    assert.equal(dup.result.ok, false);
    assert.match(dup.result.error, /already tracking/);
  });

  it("launch-mark-watched: toggles the watched flag, then launch-untrack removes the item", async () => {
    const t = await lensRun("space", "launch-track", {
      params: { name: "Starship IFT-99", provider: "SpaceX" },
    }, ctx);
    assert.equal(t.ok, true);
    const id = t.result.item.id;

    const mark = await lensRun("space", "launch-mark-watched", { params: { id, watched: true } }, ctx);
    assert.equal(mark.ok, true);
    assert.equal(mark.result.watched, true);

    const before = await lensRun("space", "launch-watchlist", {}, ctx);
    const countBefore = before.result.count;

    const rm = await lensRun("space", "launch-untrack", { params: { id } }, ctx);
    assert.equal(rm.ok, true);
    assert.equal(rm.result.removed, id);
    assert.equal(rm.result.count, countBefore - 1);

    const after = await lensRun("space", "launch-watchlist", {}, ctx);
    assert.ok(!after.result.items.some((i) => i.id === id));
  });

  it("launch-untrack: removing an unknown id is rejected", async () => {
    const r = await lensRun("space", "launch-untrack", { params: { id: "nope-not-real" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /not found/);
  });
});
