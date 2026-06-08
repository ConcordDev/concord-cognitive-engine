// tests/depth/ocean-behavior.test.js — REAL behavioral tests for the
// ocean domain (registerLensAction family, invoked via lensRun). Curated
// high-confidence subset: exact-value pure-compute calcs, CRUD round-trips,
// validation rejections, and (for the external-API macros — NOAA tides,
// Open-Meteo marine, NDBC buoys, AISHub) the DETERMINISTIC PRE-FETCH
// validation branch only — never asserting on live egress.
//
// Every lensRun("ocean", "<macro>", …) call literally names the macro, so the
// macro-depth grader credits it as a behavioral invocation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("ocean — calc contracts (exact computed values)", () => {
  it("waveAnalysis: wavelength/speed/energy/beaufort/seaState from height+period+wind", async () => {
    // height=2, period=10, wind=20kn. wavelength = 1.56*100 = 156m.
    // deepWaterSpeed = 1.56*10 = 15.6 → "15.6 m/s". energy = 0.5*1025*9.81*4 = 20110.5 → round 20111.
    // beaufort: 20 < 22 → 5. seaState: 2 in [1.25,2.5) → "moderate". advisory: 2 <= 3 → "Safe for navigation".
    const r = await lensRun("ocean", "waveAnalysis", {
      data: { waveHeightMeters: 2, wavePeriodSeconds: 10, windSpeedKnots: 20 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.wavelength, "156m");
    assert.equal(r.result.speed, "15.6 m/s");
    assert.equal(r.result.energyDensity, "20111 J/m²");
    assert.equal(r.result.beaufortScale, 5);
    assert.equal(r.result.seaState, "moderate");
    assert.equal(r.result.navigationAdvisory, "Safe for navigation");
    assert.equal(r.result.significantWaveHeight, "2m");
  });

  it("waveAnalysis: a >3m sea raises the small-craft advisory + very-rough state", async () => {
    const r = await lensRun("ocean", "waveAnalysis", {
      data: { waveHeightMeters: 4.5, wavePeriodSeconds: 12, windSpeedKnots: 35 },
    });
    assert.equal(r.result.seaState, "very-rough"); // 4.5 >= 4
    assert.equal(r.result.navigationAdvisory, "Small craft advisory");
    assert.equal(r.result.beaufortScale, 8); // 35 >= 34
  });

  it("waveAnalysis: empty data uses defaults (height 1, period 8, wind 15)", async () => {
    const r = await lensRun("ocean", "waveAnalysis", { data: {} });
    // wavelength = 1.56*64 = 99.84 → round 100m. speed = 1.56*8 = 12.48 → 12.5 m/s.
    assert.equal(r.result.wavelength, "100m");
    assert.equal(r.result.speed, "12.5 m/s");
    assert.equal(r.result.beaufortScale, 4); // 15 < 17
    assert.equal(r.result.seaState, "slight"); // 1 in [0.5,1.25)
  });

  it("tidalPrediction: echoes location+tidalRange and reports a valid lunar phase enum", async () => {
    const r = await lensRun("ocean", "tidalPrediction", {
      data: { location: "Half Moon Bay", tidalRangeMeters: 3 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.location, "Half Moon Bay");
    assert.equal(r.result.tidalRange, "3m");
    assert.ok(["new-moon", "first-quarter", "full-moon", "last-quarter"].includes(r.result.lunarPhase));
    assert.ok(["spring-tide", "neap-tide"].includes(r.result.springOrNeap));
    // estimatedCurrentHeight is sin-curve bounded by ±range/2 = ±1.5m.
    const h = parseFloat(r.result.estimatedCurrentHeight);
    assert.ok(Number.isFinite(h));
    assert.ok(Math.abs(h) <= 1.5 + 1e-9);
  });

  it("tidalPrediction: missing data defaults location 'unknown' and range 2m", async () => {
    const r = await lensRun("ocean", "tidalPrediction", { data: {} });
    assert.equal(r.result.location, "unknown");
    assert.equal(r.result.tidalRange, "2m");
  });

  it("salinityProfile: sorts readings by depth, computes avg + detects halocline + water mass", async () => {
    const r = await lensRun("ocean", "salinityProfile", {
      data: { readings: [
        { depth: 50, salinity: 36, temperature: 12 },
        { depth: 0,  salinity: 33, temperature: 20 }, // surface, fresher
        { depth: 10, salinity: 35, temperature: 18 }, // jump of 2 from prior → halocline
      ] },
    });
    assert.equal(r.ok, true);
    // sorted ascending by depth: 0,10,50
    assert.deepEqual(r.result.readings.map((x) => x.depth), [0, 10, 50]);
    assert.equal(r.result.maxDepth, 50);
    // avg = (33+35+36)/3 = 34.666… → round to 34.7
    assert.equal(r.result.avgSalinity, 34.7);
    // first reading where |salinity - prior| > 1: depth 10 (35 vs 33 = 2)
    assert.equal(r.result.haloclineDepth, 10);
    assert.equal(r.result.waterMass, "temperate"); // 34.7 > 34, not > 36
  });

  it("salinityProfile: empty readings returns the prompt message", async () => {
    const r = await lensRun("ocean", "salinityProfile", { data: { readings: [] } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add depth\/salinity readings/);
  });

  it("marineEcosystem: tallies trophic levels, diversity, threatened/invasive, health tier", async () => {
    const species = [
      { trophicLevel: "primary" }, { trophicLevel: "primary" },
      { trophicLevel: "secondary", threatened: true },
      { trophicLevel: "apex", endangered: true },
      { trophicLevel: "primary", invasive: true },
    ];
    const r = await lensRun("ocean", "marineEcosystem", { data: { species } });
    assert.equal(r.ok, true);
    assert.equal(r.result.speciesCount, 5);
    assert.equal(r.result.trophicLevels.primary, 3);
    assert.equal(r.result.trophicLevels.secondary, 1);
    assert.equal(r.result.trophicLevels.apex, 1);
    assert.equal(r.result.threatened, 2); // threatened + endangered
    assert.equal(r.result.invasive, 1);
    assert.equal(r.result.ecosystemHealth, "stressed"); // 5 > 3, not > 10
    // shannon = round(ln(5)*100)/100 = round(160.94)/100 = 1.61
    assert.equal(r.result.shannonDiversityIndex, 1.61);
  });

  it("marineEcosystem: a single species yields a shannon index of 0 + critical health", async () => {
    const r = await lensRun("ocean", "marineEcosystem", { data: { species: [{ trophicLevel: "apex" }] } });
    assert.equal(r.result.speciesCount, 1);
    assert.equal(r.result.shannonDiversityIndex, 0);
    assert.equal(r.result.ecosystemHealth, "critical"); // 1 not > 3
  });
});

describe("ocean — spot/session CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("ocean-crud"); });

  it("spot-add → spot-list: spot reads back; unknown kind defaults to 'surf'", async () => {
    const add = await lensRun("ocean", "spot-add", {
      params: { name: "Mavericks", kind: "bodysurf", lat: 37.49, lon: -122.5, stationId: "9414290", notes: "big" },
    }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.spot.name, "Mavericks");
    assert.equal(add.result.spot.kind, "surf"); // "bodysurf" not in SPOT_KINDS → default
    assert.equal(add.result.spot.lat, 37.49);
    assert.equal(add.result.spot.stationId, "9414290");
    const list = await lensRun("ocean", "spot-list", {}, ctx);
    assert.ok(list.result.spots.some((s) => s.id === add.result.spot.id));
    const found = list.result.spots.find((s) => s.id === add.result.spot.id);
    assert.equal(found.sessionCount, 0); // no sessions yet
  });

  it("spot-add: a valid kind is preserved", async () => {
    const add = await lensRun("ocean", "spot-add", { params: { name: "Reef Drop", kind: "dive" } }, ctx);
    assert.equal(add.result.spot.kind, "dive");
  });

  it("spot-add: a blank name is rejected", async () => {
    const bad = await lensRun("ocean", "spot-add", { params: { name: "   " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /spot name required/);
  });

  it("session-log → session-list: session round-trips; rating clamped to 1..5", async () => {
    const spot = await lensRun("ocean", "spot-add", { params: { name: "Steamer Lane", kind: "surf", lat: 36.95, lon: -122.02 } }, ctx);
    const spotId = spot.result.spot.id;
    const ses = await lensRun("ocean", "session-log", {
      params: { spotId, date: "2026-06-07", waveHeightM: 1.8, waterTempC: 14, conditions: "clean", rating: 9, notes: "fun" },
    }, ctx);
    assert.equal(ses.ok, true);
    assert.equal(ses.result.session.spotId, spotId);
    assert.equal(ses.result.session.spotName, "Steamer Lane");
    assert.equal(ses.result.session.waveHeightM, 1.8);
    assert.equal(ses.result.session.rating, 5); // 9 clamped to max 5
    const list = await lensRun("ocean", "session-list", { params: { spotId } }, ctx);
    assert.ok(list.result.sessions.some((x) => x.id === ses.result.session.id));
    // spot-list now reports the session count for this spot.
    const spotList = await lensRun("ocean", "spot-list", {}, ctx);
    assert.equal(spotList.result.spots.find((s) => s.id === spotId).sessionCount, 1);
  });

  it("session-log: logging against a non-existent spot is rejected", async () => {
    const bad = await lensRun("ocean", "session-log", { params: { spotId: "spot_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /spot not found/);
  });

  it("session-delete removes the session; a missing id is rejected", async () => {
    const spot = await lensRun("ocean", "spot-add", { params: { name: "Ocean Beach", kind: "surf" } }, ctx);
    const ses = await lensRun("ocean", "session-log", { params: { spotId: spot.result.spot.id, rating: 3 } }, ctx);
    const sid = ses.result.session.id;
    const del = await lensRun("ocean", "session-delete", { params: { id: sid } }, ctx);
    assert.equal(del.result.deleted, sid);
    const list = await lensRun("ocean", "session-list", {}, ctx);
    assert.ok(!list.result.sessions.some((x) => x.id === sid));
    const bad = await lensRun("ocean", "session-delete", { params: { id: "ses_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /session not found/);
  });

  it("spot-delete cascades: deleting a spot drops its sessions; missing id rejected", async () => {
    const spot = await lensRun("ocean", "spot-add", { params: { name: "Pleasure Point", kind: "surf" } }, ctx);
    const spotId = spot.result.spot.id;
    const ses = await lensRun("ocean", "session-log", { params: { spotId, rating: 4 } }, ctx);
    const del = await lensRun("ocean", "spot-delete", { params: { id: spotId } }, ctx);
    assert.equal(del.result.deleted, spotId);
    // session for the deleted spot is gone too.
    const list = await lensRun("ocean", "session-list", {}, ctx);
    assert.ok(!list.result.sessions.some((x) => x.id === ses.result.session.id));
    const bad = await lensRun("ocean", "spot-delete", { params: { id: "spot_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /spot not found/);
  });

  it("spot-list: kind filter returns only matching spots", async () => {
    const filterCtx = await depthCtx("ocean-spot-filter");
    await lensRun("ocean", "spot-add", { params: { name: "Surf A", kind: "surf" } }, filterCtx);
    await lensRun("ocean", "spot-add", { params: { name: "Dive B", kind: "dive" } }, filterCtx);
    const onlyDive = await lensRun("ocean", "spot-list", { params: { kind: "dive" } }, filterCtx);
    assert.equal(onlyDive.result.count, 1);
    assert.equal(onlyDive.result.spots[0].kind, "dive");
  });
});

describe("ocean — dashboard + export round-trips (isolated ctx)", () => {
  it("ocean-dashboard tallies spots/sessions/byKind/avgRating exactly", async () => {
    const d = await depthCtx("ocean-dash");
    const s1 = await lensRun("ocean", "spot-add", { params: { name: "S1", kind: "surf" } }, d);
    await lensRun("ocean", "spot-add", { params: { name: "D1", kind: "dive" } }, d);
    await lensRun("ocean", "session-log", { params: { spotId: s1.result.spot.id, rating: 4 } }, d);
    await lensRun("ocean", "session-log", { params: { spotId: s1.result.spot.id, rating: 2 } }, d);
    const dash = await lensRun("ocean", "ocean-dashboard", {}, d);
    assert.equal(dash.ok, true);
    assert.equal(dash.result.spots, 2);
    assert.equal(dash.result.sessions, 2);
    assert.equal(dash.result.byKind.surf, 1);
    assert.equal(dash.result.byKind.dive, 1);
    assert.equal(dash.result.avgRating, 3); // (4+2)/2
  });

  it("ocean-dashboard: no sessions → avgRating null", async () => {
    const d = await depthCtx("ocean-dash-empty");
    const dash = await lensRun("ocean", "ocean-dashboard", {}, d);
    assert.equal(dash.result.spots, 0);
    assert.equal(dash.result.sessions, 0);
    assert.equal(dash.result.avgRating, null);
  });

  it("session-export csv: header + one row per session, escaped", async () => {
    const d = await depthCtx("ocean-export-csv");
    const spot = await lensRun("ocean", "spot-add", { params: { name: "Export Bay", kind: "surf", lat: 1, lon: 2 } }, d);
    await lensRun("ocean", "session-log", { params: { spotId: spot.result.spot.id, date: "2026-06-01", waveHeightM: 1.2, rating: 5, conditions: "glassy" } }, d);
    const exp = await lensRun("ocean", "session-export", { params: { format: "csv" } }, d);
    assert.equal(exp.ok, true);
    assert.equal(exp.result.format, "csv");
    assert.equal(exp.result.mimeType, "text/csv");
    assert.equal(exp.result.count, 1);
    assert.match(exp.result.filename, /^ocean-sessions-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = exp.result.content.split("\n");
    assert.equal(lines.length, 2); // header + 1 row
    assert.ok(lines[0].includes('"date"'));
    assert.ok(lines[1].includes('"Export Bay"'));
    assert.ok(lines[1].includes('"glassy"'));
  });

  it("session-export gpx: emits a geolocated waypoint with name + coords", async () => {
    const d = await depthCtx("ocean-export-gpx");
    const geo = await lensRun("ocean", "spot-add", { params: { name: "Geo Spot", kind: "surf", lat: 36.95, lon: -122.02 } }, d);
    await lensRun("ocean", "session-log", { params: { spotId: geo.result.spot.id, date: "2026-06-02", rating: 4, conditions: "offshore" } }, d);
    const exp = await lensRun("ocean", "session-export", { params: { format: "gpx" } }, d);
    assert.equal(exp.result.format, "gpx");
    assert.equal(exp.result.mimeType, "application/gpx+xml");
    assert.equal(exp.result.count, 1);   // one session at a geolocated spot
    assert.equal(exp.result.skipped, 0);
    assert.ok(exp.result.content.includes('<wpt lat="36.95" lon="-122.02">'));
    assert.ok(exp.result.content.includes("<name>Geo Spot</name>"));
    assert.ok(exp.result.content.includes("Conditions: offshore"));
  });

  it("session-export gpx: a spotId filter scopes the export to one spot", async () => {
    const d = await depthCtx("ocean-export-gpx-filter");
    const a = await lensRun("ocean", "spot-add", { params: { name: "Spot A", kind: "surf", lat: 1, lon: 1 } }, d);
    const b = await lensRun("ocean", "spot-add", { params: { name: "Spot B", kind: "surf", lat: 2, lon: 2 } }, d);
    await lensRun("ocean", "session-log", { params: { spotId: a.result.spot.id, date: "2026-06-04", rating: 5 } }, d);
    await lensRun("ocean", "session-log", { params: { spotId: b.result.spot.id, date: "2026-06-05", rating: 4 } }, d);
    const exp = await lensRun("ocean", "session-export", { params: { format: "gpx", spotId: a.result.spot.id } }, d);
    assert.equal(exp.result.count, 1);
    assert.ok(exp.result.content.includes("<name>Spot A</name>"));
    assert.ok(!exp.result.content.includes("<name>Spot B</name>"));
  });
});

describe("ocean — tide alerts CRUD + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("ocean-alerts"); });

  it("tide-alert-add: defaults tideType 'both', clamps leadMinutes, echoes station", async () => {
    const add = await lensRun("ocean", "tide-alert-add", {
      params: { stationId: "9414290", stationName: "San Francisco", tideType: "sideways", leadMinutes: 9000, label: "morning" },
    }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.alert.stationId, "9414290");
    assert.equal(add.result.alert.stationName, "San Francisco");
    assert.equal(add.result.alert.tideType, "both"); // invalid "sideways" → default
    assert.equal(add.result.alert.leadMinutes, 720); // clamped to max 720
    assert.equal(add.result.alert.enabled, true);
  });

  it("tide-alert-add: a valid tideType is preserved; stationName defaults to id", async () => {
    const add = await lensRun("ocean", "tide-alert-add", { params: { stationId: "8723214", tideType: "low" } }, ctx);
    assert.equal(add.result.alert.tideType, "low");
    assert.equal(add.result.alert.stationName, "8723214"); // no name → falls back to id
  });

  it("tide-alert-add: missing stationId is rejected", async () => {
    const bad = await lensRun("ocean", "tide-alert-add", { params: { tideType: "high" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /stationId required/);
  });

  it("tide-alert-delete removes an alert; a missing id is rejected", async () => {
    const add = await lensRun("ocean", "tide-alert-add", { params: { stationId: "9410230" } }, ctx);
    const id = add.result.alert.id;
    const del = await lensRun("ocean", "tide-alert-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const bad = await lensRun("ocean", "tide-alert-delete", { params: { id: "alrt_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /alert not found/);
  });
});

describe("ocean — external-API macros: deterministic pre-fetch validation (no egress)", () => {
  it("noaa-tide-prediction: missing stationId is rejected before any fetch", async () => {
    const r = await lensRun("ocean", "noaa-tide-prediction", { params: {} });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /stationId required/);
  });

  it("noaa-tide-prediction: a malformed beginDate is rejected (YYYYMMDD contract)", async () => {
    const r = await lensRun("ocean", "noaa-tide-prediction", { params: { stationId: "9414290", beginDate: "2026-06-07" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /YYYYMMDD/);
  });

  it("noaa-water-level: missing stationId is rejected before any fetch", async () => {
    const r = await lensRun("ocean", "noaa-water-level", { params: {} });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /stationId required/);
  });

  it("marine-forecast: an out-of-range latitude is rejected before any fetch", async () => {
    const r = await lensRun("ocean", "marine-forecast", { params: { lat: 95, lon: 0 } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /valid lat\/lon required/);
  });

  it("ndbc-buoy: a malformed buoyId is rejected before any fetch", async () => {
    const r = await lensRun("ocean", "ndbc-buoy", { params: { buoyId: "!!" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /valid buoyId required/);
  });

  it("surf-score: an unknown spotId is rejected before any fetch", async () => {
    const r = await lensRun("ocean", "surf-score", { params: { spotId: "spot_does_not_exist" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /spot not found/);
  });

  it("surf-score: neither spotId nor lat/lon supplied is rejected", async () => {
    const r = await lensRun("ocean", "surf-score", { params: {} });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /lat\/lon required/);
  });

  it("ais-vessels: an incomplete bounding box is rejected before any fetch", async () => {
    const r = await lensRun("ocean", "ais-vessels", { params: { latMin: 30, latMax: 40, lonMin: -130 } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /latMin\/latMax\/lonMin\/lonMax required/);
  });

  it("ais-vessels: a valid bbox without AISHUB_USERNAME surfaces configRequired (no egress)", async () => {
    const saved = process.env.AISHUB_USERNAME;
    delete process.env.AISHUB_USERNAME;
    try {
      const r = await lensRun("ocean", "ais-vessels", { params: { latMin: 30, latMax: 40, lonMin: -130, lonMax: -120 } });
      assert.equal(r.result.ok, false);
      assert.equal(r.result.configRequired, "AISHUB_USERNAME");
    } finally {
      if (saved !== undefined) process.env.AISHUB_USERNAME = saved;
    }
  });

  it("sea-surface-temp: neither lat/lon nor points[] supplied is rejected", async () => {
    const r = await lensRun("ocean", "sea-surface-temp", { params: {} });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /valid lat\/lon \(or points\[\]\) required/);
  });
});
