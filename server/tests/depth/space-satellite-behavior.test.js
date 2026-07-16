// tests/depth/space-satellite-behavior.test.js — REAL behavioral tests for
// the `space` domain's user-owned satellite tracking + estimated pass
// scheduling macros (`satellite-track`, `satellite-list`, `satellite-untrack`,
// `satellite-passes`), the ENGINEERING gap-closure for the previously
// "GENUINELY MISSING" capability (docs/lens-specs/space-capability-map.md,
// line 93: "Ground-station pass scheduling for own satellites").
//
// A user-tracked satellite is a fictional/hypothetical object with no live
// ephemeris feed (unlike the ISS, which `iss-passes` samples from real
// wheretheiss.at telemetry) — so `satellite-passes` deliberately returns an
// ANALYTICAL ESTIMATE (`precision: "estimated"`), never fabricated live
// tracking. These tests pin that honesty contract explicitly, alongside the
// CRUD round-trip and the shared-formula proof against `orbitCalc`.
//
// lens.run UNWRAPS a handler's `{ok:true, result:X}` → r.result === X (read
// r.result.<field>). A handler `{ok:false, error}` (no result key) is NOT
// unwrapped → r.result.ok === false + r.result.error carries the message.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("space — satellite-track", () => {
  let user;
  before(async () => { user = await depthCtx("sat-track-" + randomUUID()); });

  it("tracks a satellite with the expected shape and defaults", async () => {
    const r = await lensRun("space", "satellite-track", { params: { name: "Concordia-1", altitudeKm: 550 } }, user);
    assert.equal(r.result.satellite.name, "Concordia-1");
    assert.equal(r.result.satellite.altitudeKm, 550);
    assert.equal(r.result.satellite.inclinationDeg, 51.6); // ISS-like default
    assert.equal(r.result.satellite.notes, "");
    assert.ok(typeof r.result.satellite.id === "string" && r.result.satellite.id.length > 0);
    assert.ok(typeof r.result.satellite.trackedAt === "string");
    assert.equal(r.result.count, 1);
  });

  it("rejects a missing name", async () => {
    const r = await lensRun("space", "satellite-track", { params: { altitudeKm: 500 } }, user);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /name required/);
  });

  it("rejects an empty/whitespace name", async () => {
    const r = await lensRun("space", "satellite-track", { params: { name: "   ", altitudeKm: 500 } }, user);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /name required/);
  });

  it("rejects a missing altitudeKm", async () => {
    const r = await lensRun("space", "satellite-track", { params: { name: "No Altitude" } }, user);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /altitudeKm required/);
  });

  it("rejects a non-numeric altitudeKm", async () => {
    const r = await lensRun("space", "satellite-track", { params: { name: "Bad Altitude", altitudeKm: "high" } }, user);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /altitudeKm required/);
  });

  it("rejects a zero altitudeKm", async () => {
    const r = await lensRun("space", "satellite-track", { params: { name: "Zero Altitude", altitudeKm: 0 } }, user);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /altitudeKm required/);
  });

  it("rejects a negative altitudeKm", async () => {
    const r = await lensRun("space", "satellite-track", { params: { name: "Negative Altitude", altitudeKm: -100 } }, user);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /altitudeKm required/);
  });

  it("accepts explicit inclinationDeg and notes", async () => {
    const r = await lensRun("space", "satellite-track", {
      params: { name: "Polar-Sat", altitudeKm: 700, inclinationDeg: 98, notes: "sun-synchronous test bird" },
    }, user);
    assert.equal(r.result.satellite.inclinationDeg, 98);
    assert.equal(r.result.satellite.notes, "sun-synchronous test bird");
  });

  it("clamps an out-of-range inclinationDeg to [0, 180]", async () => {
    const rHigh = await lensRun("space", "satellite-track", { params: { name: "TooIncl", altitudeKm: 500, inclinationDeg: 400 } }, user);
    assert.equal(rHigh.result.satellite.inclinationDeg, 180);
    const rLow = await lensRun("space", "satellite-track", { params: { name: "NegIncl", altitudeKm: 500, inclinationDeg: -50 } }, user);
    assert.equal(rLow.result.satellite.inclinationDeg, 0);
  });

  it("rejects a duplicate name (case-insensitive) for the same user", async () => {
    const r = await lensRun("space", "satellite-track", { params: { name: "concordia-1", altitudeKm: 600 } }, user);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /already tracking/);
  });

  it("allows the same name for a DIFFERENT user (per-user isolation)", async () => {
    const other = await depthCtx("sat-track-other-" + randomUUID());
    const r = await lensRun("space", "satellite-track", { params: { name: "Concordia-1", altitudeKm: 550 } }, other);
    assert.equal(r.result.satellite.name, "Concordia-1");
    assert.equal(r.result.count, 1); // fresh per-user bucket, not shared with `user`
  });
});

describe("space — satellite-list", () => {
  let user;
  before(async () => { user = await depthCtx("sat-list-" + randomUUID()); });

  it("returns an empty list for a user with no tracked satellites", async () => {
    const r = await lensRun("space", "satellite-list", {}, user);
    assert.deepEqual(r.result.satellites, []);
    assert.equal(r.result.count, 0);
  });

  it("derives periodMinutes/orbitsPerDay/type LIVE, matching orbitCalc for the same altitude", async () => {
    await lensRun("space", "satellite-track", { params: { name: "ISS-Like", altitudeKm: 420 } }, user);
    const listed = await lensRun("space", "satellite-list", {}, user);
    const sat = listed.result.satellites.find((s) => s.name === "ISS-Like");
    assert.ok(sat);

    // Proof the orbital-period helper is genuinely SHARED with orbitCalc,
    // not a second hand-copied formula that could silently drift: call
    // orbitCalc with the identical altitude and assert exact equality.
    const orbitCalcResult = await lensRun("space", "orbitCalc", { data: { altitudeKm: 420 } }, user);
    assert.equal(sat.periodMinutes, orbitCalcResult.result.periodMinutes);
    assert.equal(sat.orbitsPerDay, orbitCalcResult.result.orbitsPerDay);
    assert.equal(sat.type, orbitCalcResult.result.type);
  });

  it("classifies LEO/MEO/GEO by altitude, matching orbitCalc's thresholds", async () => {
    const isolated = await depthCtx("sat-list-tiers-" + randomUUID());
    await lensRun("space", "satellite-track", { params: { name: "LeoBird", altitudeKm: 500 } }, isolated);
    await lensRun("space", "satellite-track", { params: { name: "MeoBird", altitudeKm: 20000 } }, isolated);
    await lensRun("space", "satellite-track", { params: { name: "GeoBird", altitudeKm: 35786 } }, isolated);
    const listed = await lensRun("space", "satellite-list", {}, isolated);
    const byName = Object.fromEntries(listed.result.satellites.map((s) => [s.name, s]));
    assert.equal(byName.LeoBird.type, "LEO");
    assert.equal(byName.MeoBird.type, "MEO");
    assert.equal(byName.GeoBird.type, "GEO");
  });

  it("only returns the calling user's own satellites", async () => {
    const isolatedOwner = await depthCtx("sat-list-owner-" + randomUUID());
    const isolatedOther = await depthCtx("sat-list-stranger-" + randomUUID());
    await lensRun("space", "satellite-track", { params: { name: "PrivateBird", altitudeKm: 500 } }, isolatedOwner);
    const strangerView = await lensRun("space", "satellite-list", {}, isolatedOther);
    assert.equal(strangerView.result.satellites.some((s) => s.name === "PrivateBird"), false);
  });
});

describe("space — satellite-untrack", () => {
  let user, satelliteId;
  before(async () => {
    user = await depthCtx("sat-untrack-" + randomUUID());
    const tracked = await lensRun("space", "satellite-track", { params: { name: "ToRemove", altitudeKm: 500 } }, user);
    satelliteId = tracked.result.satellite.id;
  });

  it("rejects a fabricated id", async () => {
    const r = await lensRun("space", "satellite-untrack", { params: { id: "fake_" + randomUUID() } }, user);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /satellite not found/);
  });

  it("removes a real tracked satellite and reflects the new count", async () => {
    const before1 = await lensRun("space", "satellite-list", {}, user);
    const startCount = before1.result.count;
    const r = await lensRun("space", "satellite-untrack", { params: { id: satelliteId } }, user);
    assert.equal(r.result.removed, satelliteId);
    assert.equal(r.result.count, startCount - 1);
    const after1 = await lensRun("space", "satellite-list", {}, user);
    assert.equal(after1.result.satellites.some((s) => s.id === satelliteId), false);
  });

  it("rejects re-untracking the same id (already removed)", async () => {
    const r = await lensRun("space", "satellite-untrack", { params: { id: satelliteId } }, user);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /satellite not found/);
  });
});

describe("space — satellite-passes (honest estimate, not live tracking)", () => {
  let user, leoId;
  before(async () => {
    user = await depthCtx("sat-passes-" + randomUUID());
    // 51.6° inclination (ISS-like default) at 420km — same altitude as the
    // real ISS, so its period is comparable to well-known ISS figures
    // (~92-93 min) as a sanity check.
    const tracked = await lensRun("space", "satellite-track", { params: { name: "PassTestBird", altitudeKm: 420, inclinationDeg: 51.6 } }, user);
    leoId = tracked.result.satellite.id;
  });

  it("rejects a fabricated satellite id", async () => {
    const r = await lensRun("space", "satellite-passes", { params: { id: "fake_" + randomUUID(), latitude: 40, longitude: -75 } }, user);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /satellite not found/);
  });

  it("rejects missing latitude/longitude", async () => {
    const r = await lensRun("space", "satellite-passes", { params: { id: leoId } }, user);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /latitude and longitude required/);
  });

  it("rejects non-finite latitude/longitude", async () => {
    const r = await lensRun("space", "satellite-passes", { params: { id: leoId, latitude: "north", longitude: -75 } }, user);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /latitude and longitude required/);
  });

  it("returns a NON-zero, honestly-labeled estimate for a ground station inside the inclination band", async () => {
    const r = await lensRun("space", "satellite-passes", { params: { id: leoId, latitude: 40.7, longitude: -74.0 } }, user); // NYC, within 51.6°
    assert.equal(r.result.precision, "estimated");
    assert.match(r.result.note, /Estimated from orbital period only/);
    assert.ok(r.result.count > 0, "expected at least one estimated pass for an in-band station");
    assert.equal(r.result.passes.length, r.result.count);
    for (const p of r.result.passes) {
      assert.ok(typeof p.startUtc === "string");
      assert.ok(typeof p.endUtc === "string");
      assert.ok(new Date(p.endUtc).getTime() > new Date(p.startUtc).getTime());
      assert.ok(p.durationMinutes >= 3 && p.durationMinutes <= 20);
    }
    // passes should be spaced one orbital period apart
    if (r.result.passes.length > 1) {
      const gapMin = (new Date(r.result.passes[1].startUtc).getTime() - new Date(r.result.passes[0].startUtc).getTime()) / 60000;
      assert.ok(Math.abs(gapMin - r.result.periodMinutes) < 0.5);
    }
  });

  it("returns an HONEST zero passes for a ground station OUTSIDE the inclination band — never fabricates visibility", async () => {
    // 51.6° inclination bird can never be seen from a station at 80° latitude.
    const r = await lensRun("space", "satellite-passes", { params: { id: leoId, latitude: 80, longitude: 0 } }, user);
    assert.equal(r.result.precision, "estimated");
    assert.equal(r.result.count, 0);
    assert.deepEqual(r.result.passes, []);
    assert.match(r.result.note, /outside this satellite's.*inclination ground-track band/);
  });

  it("folds retrograde/sun-synchronous inclination correctly (>90° maps to 180-inclination max latitude)", async () => {
    const isolated = await depthCtx("sat-passes-polar-" + randomUUID());
    const tracked = await lensRun("space", "satellite-track", { params: { name: "SunSyncBird", altitudeKm: 700, inclinationDeg: 98 } }, isolated);
    const polarId = tracked.result.satellite.id;
    // max latitude ~82° — a station at 81° should be in-band, at 89° should not.
    const inBand = await lensRun("space", "satellite-passes", { params: { id: polarId, latitude: 81, longitude: 10 } }, isolated);
    assert.ok(inBand.result.count > 0);
    const outOfBand = await lensRun("space", "satellite-passes", { params: { id: polarId, latitude: 89, longitude: 10 } }, isolated);
    assert.equal(outOfBand.result.count, 0);
  });

  it("respects a custom windowHours, clamped to [1, 72]", async () => {
    const shortWindow = await lensRun("space", "satellite-passes", { params: { id: leoId, latitude: 0, longitude: 0, windowHours: 3 } }, user);
    assert.equal(shortWindow.result.windowHours, 3);
    const overLong = await lensRun("space", "satellite-passes", { params: { id: leoId, latitude: 0, longitude: 0, windowHours: 500 } }, user);
    assert.equal(overLong.result.windowHours, 72);
    const tooShort = await lensRun("space", "satellite-passes", { params: { id: leoId, latitude: 0, longitude: 0, windowHours: 0 } }, user);
    assert.ok(tooShort.result.windowHours >= 1);
  });

  it("includes the satellite + observer identity in the result", async () => {
    const r = await lensRun("space", "satellite-passes", { params: { id: leoId, latitude: 10, longitude: 20 } }, user);
    assert.equal(r.result.satellite.id, leoId);
    assert.equal(r.result.satellite.name, "PassTestBird");
    assert.equal(r.result.observer.latitude, 10);
    assert.equal(r.result.observer.longitude, 20);
  });

  it("only resolves against the calling user's own tracked satellites (no cross-user id guessing)", async () => {
    const stranger = await depthCtx("sat-passes-stranger-" + randomUUID());
    const r = await lensRun("space", "satellite-passes", { params: { id: leoId, latitude: 40, longitude: -74 } }, stranger);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /satellite not found/);
  });
});
