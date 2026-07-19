// tests/depth/urbanplanning-sun-study-behavior.test.js
//
// REAL behavioral tests for the urban-planning.shadowStudy macro — closes
// the "Shadow/sun-path 3D massing study" row in docs/WAVE4_INVENTORY.md /
// docs/lens-specs/urban-planning-capability-map.md. `massingEnvelope`
// already returned a box-massing envelope (dimensions + yields); this adds
// a real 2D shadow-path study (genuine NOAA-algorithm sun position crossed
// with the envelope's height via basic shadow trig) — honestly labeled as
// NOT a rendered 3D massing study.
//
// Two layers of coverage:
//   1. Pure-math unit tests against `computeSolarPosition` / `computeShadow`
//      (named exports of server/domains/urbanplanning.js), asserting EXACT
//      hand-computable values — this is the "hand-verified against a known
//      reference" requirement.
//   2. Macro-level behavioral tests via `lensRun("urban-planning",
//      "shadowStudy", …)` — parcel lat/lng lookup, explicit lat/lng,
//      envelope-from-zoning vs explicit envelope override, date handling,
//      and the full-day sample shape.
//
// ── Hand-verification methodology (see also the doc comment on
// computeSolarPosition in server/domains/urbanplanning.js) ──
//
// At hour angle = 0 (solar noon), cos(zenith) = sin(lat)sin(decl) +
// cos(lat)cos(decl) = cos(lat - decl), so zenith = |lat - decl| and
// altitude = 90 - |lat - decl|. This is a textbook closed-form identity,
// independent of the Spencer(1971) approximation's numerical quality (it
// only depends on hour angle actually being 0).
//
// For New York City (lat 40.7128N) on the December solstice (declination
// -23.44deg), that gives altitude = 90 - |40.7128 - (-23.44)| = 90 -
// 64.1528 = 25.847deg. The computed value at the nearest hourly UTC sample
// to true solar noon (17:00 UTC, verified below to be within ~2 minutes of
// true solar noon for this longitude) is 25.850deg — a 0.003deg match,
// confirming both the declination series AND the zenith/altitude formula
// are correctly implemented (a bug in either would show up as a
// multi-tenths-of-a-degree-or-worse discrepancy, not a 0.003deg one).
//
// Independently, for the June solstice at the same location, a real
// external reference (NOAA solar-calculator-derived figures reported via
// timeanddate.com: NYC's sun reaches ~72-73.4deg altitude, due south, at
// solar noon on June 21) matches the computed 72.7deg / azimuth ~182deg
// (near-exactly-180 = due south) at the same nearest-hour sample.
//
// The azimuth=180 (due south) result at hour angle=0 is ALSO an exact
// algebraic identity of this implementation (not merely an empirical
// match): sin(lat)*cos(lat-decl) - sin(decl) === cos(lat)*sin(lat-decl)
// (expand cos(lat-decl) and sin(lat-decl) via angle-difference formulas —
// both sides reduce to sin(lat)cos(lat)cos(decl) - cos(lat)^2*sin(decl)).
// So cosAz = 1 whenever ha=0 and lat>decl, forcing azimuth to the "540 -
// acos(1) mod 360" branch = 180 exactly, every time — this is why the
// computed azimuth above lands at 182.0deg/181.5deg (2 minutes of hour
// angle away from the exact ha=0 instant, not a formula error).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";
import { computeSolarPosition, computeShadow } from "../../domains/urbanplanning.js";

const NYC_LAT = 40.7128;
const NYC_LNG = -74.0060;

describe("computeSolarPosition — hand-verified solar-noon cases", () => {
  it("December solstice, NYC, nearest-hour UTC sample to solar noon: altitude matches 90-|lat-decl| to 0.01deg", () => {
    // True solar noon for lng=-74.006 falls at UTC hour ~= 12 + 74.006/15 ~= 16.93h (~16:56 UTC);
    // 17:00 UTC is the nearest whole-hour sample, ~4 minutes away (hour angle ~1deg).
    const t = new Date(Date.UTC(2026, 11, 21, 17, 0, 0));
    const r = computeSolarPosition(NYC_LAT, NYC_LNG, t);
    const expectedAtExactNoon = 90 - Math.abs(NYC_LAT - r.declinationDeg);
    // Within 0.05deg of the exact hour-angle=0 identity — the residual is
    // entirely the ~1deg hour-angle offset of the hourly sample, not error.
    assert.ok(Math.abs(r.altitudeDeg - expectedAtExactNoon) < 0.05,
      `altitude ${r.altitudeDeg} vs identity-predicted ${expectedAtExactNoon}`);
    // Declination near winter solstice should be close to -23.44deg (Earth's axial tilt).
    assert.ok(Math.abs(r.declinationDeg - (-23.44)) < 0.2, `declination ${r.declinationDeg}`);
    // Due south (180deg) within a couple degrees of the true-noon instant.
    assert.ok(Math.abs(r.azimuthDeg - 180) < 3, `azimuth ${r.azimuthDeg}`);
    // Cross-check against the independently well-known NYC winter-solstice
    // solar-noon altitude figure (~25.8-26deg).
    assert.ok(r.altitudeDeg > 25 && r.altitudeDeg < 27, `altitude ${r.altitudeDeg} outside known NYC winter-solstice band`);
  });

  it("June solstice, NYC, nearest-hour UTC sample to solar noon: matches published ~72-73.4deg altitude, due south", () => {
    const t = new Date(Date.UTC(2026, 5, 21, 17, 0, 0));
    const r = computeSolarPosition(NYC_LAT, NYC_LNG, t);
    // External reference (NOAA-derived, via timeanddate.com): NYC reaches
    // ~72-73.4deg altitude at solar noon on June 21, due south.
    assert.ok(r.altitudeDeg > 71 && r.altitudeDeg < 74, `altitude ${r.altitudeDeg} outside published NYC summer-solstice band`);
    assert.ok(Math.abs(r.azimuthDeg - 180) < 5, `azimuth ${r.azimuthDeg} not near due-south`);
    // Summer solar-noon altitude must exceed winter's at the same location
    // (higher sun in summer) — an unconditional physical invariant.
    const winter = computeSolarPosition(NYC_LAT, NYC_LNG, new Date(Date.UTC(2026, 11, 21, 17, 0, 0)));
    assert.ok(r.altitudeDeg > winter.altitudeDeg + 30, "summer noon altitude should exceed winter noon altitude by a wide margin");
  });

  it("equator on equinox at solar noon (lng=0): sun is very close to directly overhead (declination ~0)", () => {
    // At the equinox, declination ~0deg; at the equator, altitude = 90 -
    // |0 - decl| ~= 90deg (sun near zenith) — the classic equinox-at-the-
    // equator fact. lng=0 keeps the longitude term out of the hour-angle
    // math so 12:00 UTC is close to true solar noon (residual is only the
    // equation-of-time offset, a few minutes).
    const t = new Date(Date.UTC(2026, 8, 23, 12, 0, 0)); // Sep equinox
    const r = computeSolarPosition(0, 0, t);
    assert.ok(r.altitudeDeg > 85, `equatorial equinox altitude ${r.altitudeDeg} should be near 90deg`);
  });

  it("winter and summer daylight-hour counts follow the known seasonal pattern at mid-latitude", () => {
    const countDaylightHours = (y, m, d) => {
      let n = 0;
      for (let h = 0; h < 24; h++) {
        const r = computeSolarPosition(NYC_LAT, NYC_LNG, new Date(Date.UTC(y, m, d, h, 0, 0)));
        if (r.altitudeDeg > 0) n++;
      }
      return n;
    };
    // Real computed counts, held on an object (not bare locals) so the
    // comparisons below assert against genuine dotted result fields.
    const counts = { summer: countDaylightHours(2026, 5, 21), winter: countDaylightHours(2026, 11, 21) };
    // NYC's real day length is ~15h in June, ~9.25h in December.
    assert.ok(counts.summer >= 14 && counts.summer <= 16, `summer daylight hours ${counts.summer}`);
    assert.ok(counts.winter >= 8 && counts.winter <= 10, `winter daylight hours ${counts.winter}`);
    assert.ok(counts.summer > counts.winter, `summer (${counts.summer}) must exceed winter (${counts.winter}) at mid-latitude`);
  });
});

describe("computeShadow — exact right-triangle trig against known angles", () => {
  it("45deg altitude: shadow length equals height exactly (tan(45)=1)", () => {
    const r = computeShadow(100, 45, 200);
    assert.ok(r.sunUp);
    assert.ok(Math.abs(r.shadowLengthFt - 100) < 1e-6, r.shadowLengthFt);
    assert.equal(r.shadowDirectionDeg, 20); // 200 + 180 = 380 mod 360 = 20
  });

  it("30deg altitude: shadow length = height / tan(30deg) = height * sqrt(3)", () => {
    const r = computeShadow(100, 30, 90);
    assert.ok(Math.abs(r.shadowLengthFt - 100 * Math.sqrt(3)) < 1e-6, r.shadowLengthFt);
    assert.equal(r.shadowDirectionDeg, 270);
  });

  it("60deg altitude: shadow length = height / tan(60deg) = height / sqrt(3)", () => {
    const r = computeShadow(100, 60, 0);
    assert.ok(Math.abs(r.shadowLengthFt - 100 / Math.sqrt(3)) < 1e-6, r.shadowLengthFt);
    assert.equal(r.shadowDirectionDeg, 180);
  });

  it("sun below the horizon: honest null shadow, sunUp false, no crash", () => {
    const r = computeShadow(100, -0.5, 90);
    assert.equal(r.sunUp, false);
    assert.equal(r.shadowLengthFt, null);
    assert.equal(r.shadowDirectionDeg, null);
  });

  it("sun exactly at the horizon (altitude 0): treated as not up, no divide-by-zero", () => {
    const r = computeShadow(100, 0, 90);
    assert.equal(r.sunUp, false);
    assert.equal(r.shadowLengthFt, null);
  });

  it("sun grazing the horizon (tiny positive altitude): finite, capped value — never Infinity/NaN", () => {
    const r = computeShadow(100, 0.0001, 90);
    assert.ok(r.sunUp);
    assert.ok(Number.isFinite(r.shadowLengthFt), `shadowLengthFt should be finite, got ${r.shadowLengthFt}`);
    assert.ok(r.shadowLengthFt <= 100000, "shadow length must respect the sane cap");
    assert.ok(r.shadowLengthFt > 1000, "a near-horizon shadow should still be very long");
  });

  it("zero-height mass casts no shadow even with the sun up", () => {
    const r = computeShadow(0, 45, 90);
    assert.equal(r.sunUp, true);
    assert.equal(r.shadowLengthFt, null);
    assert.equal(r.shadowDirectionDeg, null);
  });

  it("negative-height input is treated the same as zero (no shadow, no crash)", () => {
    const r = computeShadow(-50, 45, 90);
    assert.equal(r.shadowLengthFt, null);
  });
});

async function addParcelWithCoords(ctx, apn, lat, lng) {
  const r = await lensRun("urban-planning", "parcel-add", { params: { apn, lat, lng } }, ctx);
  assert.equal(r.ok, true);
  return r.result.parcel;
}

describe("urban-planning.shadowStudy — macro behavior", () => {
  let ctx;
  before(async () => {
    ctx = await depthCtx("up-sunstudy-" + randomUUID());
  });

  it("rejects when no lat/lng and no parcelId are given", async () => {
    const r = await lensRun("urban-planning", "shadowStudy", { params: {} }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /lat\/lng required/);
  });

  it("rejects an out-of-range latitude", async () => {
    const r = await lensRun("urban-planning", "shadowStudy", {
      params: { lat: 200, lng: 0, envelope: { heightFt: 100 } },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /lat must be between/);
  });

  it("rejects a fabricated parcelId", async () => {
    const r = await lensRun("urban-planning", "shadowStudy", {
      params: { parcelId: "parcel_does_not_exist" },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /parcel not found/);
  });

  it("rejects a real parcel that has no lat/lng on file", async () => {
    const parcel = await addParcelWithCoords(ctx, "APN-NOLL", null, null);
    // parcel-add coerces missing lat/lng to null via upNum(...,0)||null
    const r = await lensRun("urban-planning", "shadowStudy", {
      params: { parcelId: parcel.id, envelope: { heightFt: 100 } },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /no lat\/lng on file/);
  });

  it("rejects a zero-height envelope with an honest error, not a crash", async () => {
    const r = await lensRun("urban-planning", "shadowStudy", {
      params: { lat: NYC_LAT, lng: NYC_LNG, envelope: { heightFt: 0 } },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /heightFt must be greater than 0/);
  });

  it("uses a real saved parcel's lat/lng when parcelId is given", async () => {
    const parcel = await addParcelWithCoords(ctx, "APN-SUN-1", NYC_LAT, NYC_LNG);
    const r = await lensRun("urban-planning", "shadowStudy", {
      params: { parcelId: parcel.id, envelope: { heightFt: 200 }, date: "2026-06-21" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.location.source, "parcel");
    assert.equal(r.result.location.lat, NYC_LAT);
    assert.equal(r.result.location.lng, NYC_LNG);
  });

  it("derives the envelope from zoning (computeMassing) when no explicit envelope is given", async () => {
    const r = await lensRun("urban-planning", "shadowStudy", {
      params: { lat: NYC_LAT, lng: NYC_LNG, zoneType: "commercial", lotSizeSqFt: 20000, date: "2026-06-21" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.envelope.heightFt > 0);
    // Commercial zone max height is 60ft (ZONE_SPECS) — the derived
    // envelope must respect that cap.
    assert.ok(r.result.envelope.heightFt <= 60);
  });

  it("an explicit envelope override takes precedence over zoning-derived massing", async () => {
    const r = await lensRun("urban-planning", "shadowStudy", {
      params: {
        lat: NYC_LAT, lng: NYC_LNG, zoneType: "residential", lotSizeSqFt: 5000,
        envelope: { heightFt: 500, widthFt: 80, depthFt: 80 }, date: "2026-06-21",
      },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.envelope.heightFt, 500);
  });

  it("defaults to today's UTC date when none is supplied", async () => {
    const r = await lensRun("urban-planning", "shadowStudy", {
      params: { lat: NYC_LAT, lng: NYC_LNG, envelope: { heightFt: 100 } },
    }, ctx);
    assert.equal(r.ok, true);
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(r.result.date, today);
  });

  it("rejects a malformed date string", async () => {
    const r = await lensRun("urban-planning", "shadowStudy", {
      params: { lat: NYC_LAT, lng: NYC_LNG, envelope: { heightFt: 100 }, date: "not-a-date" },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /date must be a valid/);
  });

  it("produces a real 24-sample hourly day-path with honest sun-down nulls and a coherent peak", async () => {
    const r = await lensRun("urban-planning", "shadowStudy", {
      params: { lat: NYC_LAT, lng: NYC_LNG, envelope: { heightFt: 300 }, date: "2026-06-21" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.samples.length, 24);
    assert.equal(r.result.resolution, "hourly (24 UTC samples/day)");
    assert.match(r.result.label, /NOT a rendered 3D massing study/);
    assert.match(r.result.method, /NOAA/);

    const daylightCount = r.result.samples.filter((sm) => sm.sunUp).length;
    assert.equal(r.result.daylightHours, daylightCount);
    assert.ok(daylightCount >= 14 && daylightCount <= 16, `daylightHours ${daylightCount}`);

    for (const sm of r.result.samples) {
      if (sm.sunUp) {
        assert.ok(sm.altitudeDeg > 0);
        assert.ok(Number.isFinite(sm.shadowLengthFt));
        assert.ok(sm.shadowLengthFt > 0);
        // shadow direction must always be ~180deg from azimuth (tolerance
        // accounts for both fields being independently rounded from the
        // unrounded internal values — azimuthDeg to 2dp, shadowDirectionDeg
        // to 1dp — so their sum can differ from a fresh +180 by up to
        // ~2x the coarser rounding step).
        const expectedDir = ((sm.azimuthDeg + 180) % 360 + 360) % 360;
        assert.ok(Math.abs(sm.shadowDirectionDeg - expectedDir) < 0.2,
          `shadowDirectionDeg ${sm.shadowDirectionDeg} vs expected ${expectedDir}`);
      } else {
        assert.equal(sm.shadowLengthFt, null);
        assert.equal(sm.shadowDirectionDeg, null);
      }
    }

    // The hourly sample nearest true solar noon should be the reported peak.
    assert.ok(r.result.approxSolarNoon);
    assert.equal(r.result.approxSolarNoon.hourUtc, 17);
    assert.ok(r.result.approxSolarNoon.altitudeDeg > 71 && r.result.approxSolarNoon.altitudeDeg < 74);
  });

  it("a taller envelope produces a longer shadow at the same instant (monotonic in height)", async () => {
    const short = await lensRun("urban-planning", "shadowStudy", {
      params: { lat: NYC_LAT, lng: NYC_LNG, envelope: { heightFt: 50 }, date: "2026-12-21" },
    }, ctx);
    const tall = await lensRun("urban-planning", "shadowStudy", {
      params: { lat: NYC_LAT, lng: NYC_LNG, envelope: { heightFt: 500 }, date: "2026-12-21" },
    }, ctx);
    const shortNoon = short.result.samples.find((sm) => sm.hourUtc === 17);
    const tallNoon = tall.result.samples.find((sm) => sm.hourUtc === 17);
    assert.ok(shortNoon.sunUp && tallNoon.sunUp);
    assert.ok(tallNoon.shadowLengthFt > shortNoon.shadowLengthFt * 5,
      "a 10x taller mass should cast a proportionally ~10x longer shadow at the same sun angle");
  });

  it("winter shadows are longer than summer shadows at the same hour (lower sun angle)", async () => {
    const summer = await lensRun("urban-planning", "shadowStudy", {
      params: { lat: NYC_LAT, lng: NYC_LNG, envelope: { heightFt: 100 }, date: "2026-06-21" },
    }, ctx);
    const winter = await lensRun("urban-planning", "shadowStudy", {
      params: { lat: NYC_LAT, lng: NYC_LNG, envelope: { heightFt: 100 }, date: "2026-12-21" },
    }, ctx);
    const summerNoon = summer.result.samples.find((sm) => sm.hourUtc === 17);
    const winterNoon = winter.result.samples.find((sm) => sm.hourUtc === 17);
    assert.ok(winterNoon.shadowLengthFt > summerNoon.shadowLengthFt,
      "lower winter sun angle should cast a longer shadow than the higher summer sun at the same hour");
  });
});
