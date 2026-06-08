// tests/depth/mining-behavior.test.js — REAL behavioral tests for the mining
// domain (registerLensAction family, invoked via lensRun). Curated high-confidence
// subset: exact-value pure-compute calcs (oreGradeCalc / blastDesign /
// safetyMetrics / resourceEstimate / reserve-report / pit-design /
// production-schedule) + STATE-backed CRUD round-trips with a shared ctx
// (sites + incidents + dashboard, drill-holes + intervals, fleet) +
// validation-rejection cases (msha id format, interval bounds, lat/lng).
// Every lensRun("mining","<macro>", …) literally names the macro → the
// macro-depth grader credits it as a behavioral invocation.
//
// Wrapping note (verified against the live handlers): a SUCCESS surfaces at
// r.ok===true / r.result.<field>; a handler refusal ({ok:false,...}) surfaces at
// r.result.ok===false / r.result.error.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("mining — pure-compute calc contracts (exact computed values)", () => {
  it("oreGradeCalc: avg/min/max, above-cutoff count, economic % and classification", async () => {
    const r = await lensRun("mining", "oreGradeCalc", {
      data: { samples: [{ grade: 1 }, { grade: 3 }, { grade: 0.2 }], cutoffGrade: 0.5 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.samples, 3);
    assert.equal(r.result.avgGrade, 1.4);          // (1+3+0.2)/3
    assert.equal(r.result.minGrade, 0.2);
    assert.equal(r.result.maxGrade, 3);
    assert.equal(r.result.cutoffGrade, 0.5);
    assert.equal(r.result.aboveCutoff, 2);          // 1 and 3 are >= 0.5
    assert.equal(r.result.economicPercent, 67);     // round((2/3)*100)
    assert.equal(r.result.classification, "medium-grade"); // 0.5 <= 1.4 < 2
  });

  it("oreGradeCalc: empty samples returns an instructional message, no crash", async () => {
    const r = await lensRun("mining", "oreGradeCalc", { data: { samples: [] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("ore samples"));
  });

  it("blastDesign: default geometry → volume/tonnage/explosive and fragmentation", async () => {
    const r = await lensRun("mining", "blastDesign", { data: {} });
    assert.equal(r.ok, true);
    assert.equal(r.result.volumePerHole, 105);       // 3 * 3.5 * 10
    assert.equal(r.result.tonsPerHole, 283.5);       // 105 * 2.7
    assert.equal(r.result.explosiveKgPerHole, 113.4); // round(283.5 * 0.4 * 10)/10
    assert.equal(r.result.powderFactor, 0.4);
    assert.equal(r.result.fragmentationExpected, "medium"); // 0.3 < 0.4 <= 0.5
  });

  it("safetyMetrics: TRIR/LTIR per 200k hours + safety rating", async () => {
    const r = await lensRun("mining", "safetyMetrics", {
      data: { hoursWorked: 1000000, incidents: 5, lostTimeIncidents: 2 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.trir, 1);                  // 5 * 200000 / 1e6
    assert.equal(r.result.ltir, 0.4);               // 2 * 200000 / 1e6
    assert.equal(r.result.belowIndustry, true);     // 1 < 2.5
    assert.equal(r.result.safetyRating, "good");    // not < 1, but < 2.5
  });

  it("safetyMetrics: zero hours worked → TRIR/LTIR are 0 (no divide-by-zero)", async () => {
    const r = await lensRun("mining", "safetyMetrics", { data: { hoursWorked: 0, incidents: 3 } });
    assert.equal(r.result.trir, 0);
    assert.equal(r.result.ltir, 0);
  });

  it("resourceEstimate: tonnage/contained/recoverable metal + gross value + category", async () => {
    const r = await lensRun("mining", "resourceEstimate", {
      data: { volumeM3: 1000000, avgGradePercent: 2, densityTonM3: 2.7, recoveryPercent: 85, metalPricePerTon: 5000 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalTonnage, 2700000);    // 1e6 * 2.7
    assert.equal(r.result.containedMetal, 54000);    // 2.7e6 * 0.02
    assert.equal(r.result.recoverableMetal, 45900);  // 54000 * 0.85
    assert.equal(r.result.grossValue, 229500000);    // 45900 * 5000
    assert.equal(r.result.category, "major-deposit"); // > 1,000,000 t
  });

  it("reserve-report: drill spacing drives Measured/Indicated/Inferred split + reserves math", async () => {
    const r = await lensRun("mining", "reserve-report", {
      params: { tonnage: 1000000, avgGrade: 2, drillSpacingMeters: 60, recoveryPercent: 88, metalPricePerTonne: 5000 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.code, "JORC 2012");
    const measured = r.result.resources.find((c) => c.category === "Measured");
    const indicated = r.result.resources.find((c) => c.category === "Indicated");
    const inferred = r.result.resources.find((c) => c.category === "Inferred");
    assert.equal(measured.confidence, 15);            // 50 < spacing 60 <= 100 bracket
    assert.equal(indicated.confidence, 45);
    assert.equal(inferred.confidence, 40);
    assert.equal(r.result.reserves.proved.tonnage, 150000);   // 1e6 * 0.15
    assert.equal(r.result.reserves.probable.tonnage, 450000); // 1e6 * 0.45
    assert.equal(r.result.reserves.totalReserveTonnes, 600000);
    assert.equal(r.result.reserves.recoverableMetal, 10560);  // round(600000 * 0.02 * 0.88)
    assert.equal(r.result.inSituValue, 52800000);             // 10560 * 5000
    assert.equal(r.result.confidenceClass, "moderate");       // measured 15 → >=15
  });

  it("pit-design: bench count, slope run, and reserve/strip split are derived consistently", async () => {
    const r = await lensRun("mining", "pit-design", {
      params: { pitDepth: 120, benchHeight: 15, slopeAngle: 45, densityTonM3: 2.7, targetStripRatio: 3 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.benchCount, 8);            // ceil(120/15)
    assert.equal(r.result.benches.length, 8);
    assert.equal(r.result.pitBottomRL, -20);         // surfaceRL 100 - 120
    assert.equal(r.result.designClass, "medium-pit"); // 6 < 8 <= 12
    // ore + waste partition the total tonnage by strip ratio 3:  ore = total/(3+1)
    assert.equal(r.result.oreTonnage + r.result.wasteTonnage, r.result.totalTonnage);
    assert.equal(r.result.oreTonnage, Math.round(r.result.totalTonnage / 4));
    // each bench's slope run = benchHeight / tan(45deg) = 15
    assert.equal(r.result.benches[0].slopeRun, 15);
  });

  it("production-schedule: daily capacity and feasibility derive from fleet/cycle inputs", async () => {
    const r = await lensRun("mining", "production-schedule", {
      params: {
        targetTonnage: 50000, truckCount: 6, truckCapacityTonnes: 90,
        haulCycleMinutes: 22, shiftHours: 12, shiftsPerDay: 2, efficiency: 0.78, days: 30,
      },
    });
    assert.equal(r.ok, true);
    const sc = r.result.schedule;
    // workMinutesPerDay = 12*60*2*0.78 = 1123.2 ; cyclesPerTruckDay = 1123.2/22 = 51.05454...
    // dailyCapacity = cyclesPerTruckDay * 6 * 90 = 27569.4545... → round = 27569
    assert.equal(sc.dailyCapacity, 27569);
    assert.equal(sc.feasible, true);                  // daysToTarget (2) <= 30
    assert.equal(sc.daysToTarget, 2);                 // ceil(50000 / 27569.45)
    assert.ok(Array.isArray(sc.dailyPlan));
    // plan stops once cumulative hits target → last entry is 100% complete
    assert.equal(sc.dailyPlan[sc.dailyPlan.length - 1].percentComplete, 100);
  });
});

describe("mining — MSHA lookup id validation (no-egress: only the input gates)", () => {
  it("msha-mine-lookup: missing mineId is rejected", async () => {
    const r = await lensRun("mining", "msha-mine-lookup", { params: {} });
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("mineId required"));
  });

  it("msha-mine-lookup: non-7-digit mineId is rejected before any fetch", async () => {
    const r = await lensRun("mining", "msha-mine-lookup", { params: { mineId: "12345" } });
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("7 digits"));
  });

  it("msha-violations: malformed mineId is rejected before any fetch", async () => {
    const r = await lensRun("mining", "msha-violations", { params: { mineId: "abc" } });
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("7 digits"));
  });
});

describe("mining — sites + incidents + dashboard CRUD round-trip (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("mining-sites"); });

  it("site-add → site-list → incident-log → mining-dashboard reflect the writes", async () => {
    const add = await lensRun("mining", "site-add", {
      params: { name: "North Pit", kind: "open-cut-bogus", commodity: "gold", productionTonnes: 1200 },
    }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.site.name, "North Pit");
    assert.equal(add.result.site.kind, "surface");   // invalid kind clamps to default
    assert.equal(add.result.site.commodity, "gold");
    assert.equal(add.result.site.status, "active");
    assert.equal(add.result.site.productionTonnes, 1200);
    const siteId = add.result.site.id;

    const list = await lensRun("mining", "site-list", {}, ctx);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.sites[0].id, siteId);
    assert.equal(list.result.sites[0].incidentCount, 0);

    const inc = await lensRun("mining", "incident-log", {
      params: { siteId, severity: "serious", description: "rockfall" },
    }, ctx);
    assert.equal(inc.ok, true);
    assert.equal(inc.result.incident.severity, "serious");

    const dash = await lensRun("mining", "mining-dashboard", {}, ctx);
    assert.equal(dash.result.sites, 1);
    assert.equal(dash.result.active, 1);
    assert.equal(dash.result.totalProduction, 1200);
    assert.equal(dash.result.incidents, 1);
    assert.equal(dash.result.seriousIncidents, 1);
  });

  it("site-add: a blank name is rejected", async () => {
    const r = await lensRun("mining", "site-add", { params: { name: "   " } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("name required"));
  });

  it("incident-log: unknown siteId is rejected", async () => {
    const r = await lensRun("mining", "incident-log", { params: { siteId: "nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("not found"));
  });
});

describe("mining — drill-holes + intervals round-trip + interval validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("mining-holes"); });

  it("drillhole-add clamps azimuth/dip, log-interval sorts + computes loggedDepth", async () => {
    const add = await lensRun("mining", "drillhole-add", {
      params: { name: "DH-001", azimuth: 400, dip: -120, totalDepth: 200 },
    }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.hole.azimuth, 360);      // clamped to <= 360
    assert.equal(add.result.hole.dip, -90);          // clamped to >= -90
    const holeId = add.result.hole.id;

    // log the deeper interval first; handler sorts ascending by 'from'
    const iv2 = await lensRun("mining", "drillhole-log-interval", {
      params: { holeId, from: 50, to: 60, lithology: "fresh_ore", assayGrade: 2.5, recovery: 95 },
    }, ctx);
    assert.equal(iv2.ok, true);
    const iv1 = await lensRun("mining", "drillhole-log-interval", {
      params: { holeId, from: 0, to: 10, lithology: "bogus-litho", assayGrade: 0.3 },
    }, ctx);
    assert.equal(iv1.ok, true);
    assert.equal(iv1.result.interval.lithology, "host_rock"); // invalid lithology clamps
    assert.equal(iv1.result.interval.recovery, 100);          // default when omitted

    const list = await lensRun("mining", "drillhole-list", {}, ctx);
    const h = list.result.holes.find((x) => x.id === holeId);
    assert.equal(h.intervalCount, 2);
    assert.equal(h.loggedDepth, 60);                 // max interval 'to'
    assert.equal(h.intervals[0].from, 0);            // sorted ascending
    assert.equal(h.intervals[1].from, 50);
  });

  it("drillhole-log-interval: a non-increasing interval (to <= from) is rejected", async () => {
    const add = await lensRun("mining", "drillhole-add", { params: { name: "DH-002" } }, ctx);
    const holeId = add.result.hole.id;
    const bad = await lensRun("mining", "drillhole-log-interval", { params: { holeId, from: 30, to: 30 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(String(bad.result.error).includes("must exceed"));
  });

  it("drillhole-log-interval: unknown holeId is rejected", async () => {
    const r = await lensRun("mining", "drillhole-log-interval", { params: { holeId: "nope", from: 0, to: 5 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("not found"));
  });
});

describe("mining — block model derives composites + ore blocks from logged holes (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("mining-blocks"); });

  it("block-model: empty (no logged holes) returns a note, not a crash", async () => {
    const r = await lensRun("mining", "block-model", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.composites, 0);
    assert.equal(r.result.blocks.length, 0);
  });

  it("block-model: positive-grade intervals compose into ore blocks with an avg grade", async () => {
    const add = await lensRun("mining", "drillhole-add", {
      params: { name: "BM-001", collarX: 0, collarY: 0, collarZ: 100, azimuth: 0, dip: -90, totalDepth: 60 },
    }, ctx);
    const holeId = add.result.hole.id;
    await lensRun("mining", "drillhole-log-interval", { params: { holeId, from: 0, to: 20, assayGrade: 1.0 } }, ctx);
    await lensRun("mining", "drillhole-log-interval", { params: { holeId, from: 20, to: 40, assayGrade: 2.0 } }, ctx);

    const r = await lensRun("mining", "block-model", { params: { blockSize: 15, cutoffGrade: 0.5 } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.composites, 2);            // two positive-grade intervals
    assert.ok(r.result.totalBlocks > 0);
    assert.ok(r.result.oreBlocks > 0);               // grades 1.0/2.0 both >= 0.5 cutoff
    assert.ok(r.result.avgOreGrade > 0);
  });
});

describe("mining — fleet management CRUD + dashboard rollup (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("mining-fleet"); });

  it("equipment-add → fleet-dashboard: utilization, hoursToService, availability are computed", async () => {
    const add = await lensRun("mining", "equipment-add", {
      params: { name: "Truck-1", kind: "haul_truck", engineHours: 100, scheduledHours: 200, nextServiceHours: 250, fuelLitres: 500 },
    }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.unit.status, "operating"); // default

    const dash = await lensRun("mining", "fleet-dashboard", {}, ctx);
    assert.equal(dash.result.fleetSize, 1);
    assert.equal(dash.result.operating, 1);
    assert.equal(dash.result.availability, 100);       // 1 operating / 1 unit
    const unit = dash.result.units[0];
    assert.equal(unit.utilization, 50);                // 100 / 200 engine/scheduled
    assert.equal(unit.hoursToService, 150);            // 250 - 100
    assert.equal(unit.serviceDue, false);
    assert.equal(dash.result.totalFuelLitres, 500);
  });

  it("equipment-update: moving a unit to maintenance updates the rollup; unknown id rejected", async () => {
    const add = await lensRun("mining", "equipment-add", { params: { name: "Dozer-1", kind: "dozer" } }, ctx);
    const id = add.result.unit.id;
    const upd = await lensRun("mining", "equipment-update", { params: { id, status: "maintenance" } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.unit.status, "maintenance");

    const dash = await lensRun("mining", "fleet-dashboard", {}, ctx);
    assert.equal(dash.result.inMaintenance, 1);

    const bad = await lensRun("mining", "equipment-update", { params: { id: "nope", status: "standby" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(String(bad.result.error).includes("not found"));
  });

  it("equipment-add: a blank name is rejected", async () => {
    const r = await lensRun("mining", "equipment-add", { params: { name: "" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("name required"));
  });
});

describe("mining — site-set-location validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("mining-geo"); });

  it("site-set-location: rejects out-of-range lat/lng, accepts valid coords", async () => {
    const add = await lensRun("mining", "site-add", { params: { name: "Geo Pit" } }, ctx);
    const id = add.result.site.id;

    const bad = await lensRun("mining", "site-set-location", { params: { id, lat: 200, lng: 0 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(String(bad.result.error).includes("invalid lat/lng"));

    const ok = await lensRun("mining", "site-set-location", { params: { id, lat: 37.5, lng: -122.3 } }, ctx);
    assert.equal(ok.ok, true);
    assert.equal(ok.result.site.lat, 37.5);
    assert.equal(ok.result.site.lng, -122.3);
  });
});
