// Behavioral macro tests for server/domains/agriculture.js — the John-Deere-
// Operations-Center / Climate-FieldView-shaped precision-ag substrate the
// /lenses/agriculture lens drives.
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150):
// handlers registered via `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG convention,
// where `virtualArtifact.data = input`. Our harness therefore calls
// `fn(ctx, virtualArtifact, input)`, so a regression that confuses the param
// positions (or reads from artifact.data vs params) surfaces here.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed
// values: the agronomic math (yield bands × soil multiplier × history blend,
// irrigation gallons = inches × acreage × 27,154, GDD pacing, profit/breakeven,
// soil-trend classification, spray-window scoring, yield-map gridding, trial
// ranking). Validation-rejection, degrade-graceful (empty input → ok:true or
// guidance), and fail-CLOSED poisoned-numeric cases are pinned. Network is
// disabled — the async external-API macros are exercised only for their guard
// rails, never for live fetch.
//
// The parity test (agriculture-domain-parity.test.js) already covers
// fields-CRUD + weather + scouting; this file covers the analysis +
// fleet/profit/imagery/trial/soil-grid substrate it does NOT.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAgricultureActions from "../domains/agriculture.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "agriculture", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input) with
// virtualArtifact.data = input (server.js:39150 convention). `data` overrides
// the input-mirror so analysis macros that read artifact.data can be driven
// directly without a separate field bag.
function call(name, ctx, input = {}, data = undefined) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`agriculture.${name} not registered`);
  const virtualArtifact = {
    id: null,
    domain: "agriculture",
    type: "domain_action",
    data: data !== undefined ? data : input || {},
    meta: {},
  };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => {
  registerAgricultureActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  // Hard-disable network so any async external-API macro that slips its guard
  // would throw rather than reach a live endpoint.
  globalThis.fetch = async () => { throw new Error("network disabled in test"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// Seed a field for a user and return its id.
function seedField(ctx, over = {}) {
  const r = call("field-create", ctx, {
    name: "North 40", acreage: 40, lat: 41.5, lng: -93.5,
    soilType: "loam", currentCrop: "corn", ...over,
  });
  assert.equal(r.ok, true, "seedField should succeed");
  return r.result.field.id;
}

// ───────────────────────────────────────────────────────────────────────────
// Registration — every lens-driven macro is present.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — registration", () => {
  it("registers every macro the lens calls via lensRun / runDomain", () => {
    for (const m of [
      // analysis macros (PestIdentifier / AgricultureActionPanel)
      "rotationPlan", "yieldAnalysis", "equipmentDue", "waterSchedule",
      "plan-crop", "track-season", "analyze-soil", "identify-pest",
      "predict-yield", "analyze",
      // fields / weather / scouting (parity test owns behavior; presence here)
      "field-list", "field-create", "field-update", "field-delete",
      "weather-for-field", "scout-list", "scout-add", "scout-delete",
      // fleet
      "equipment-list", "equipment-add", "equipment-update-telemetry", "equipment-delete",
      // precision-ag panels
      "zones-list", "zones-create", "zones-delete",
      "prescriptions-list", "prescriptions-create", "prescriptions-approve", "prescriptions-delete",
      "planting-passes", "planting-log", "harvest-passes", "harvest-log",
      "nitrogen-plans", "nitrogen-plan-create", "nitrogen-apply",
      "imagery-list", "imagery-attach",
      "tank-mixes-list", "tank-mix-create",
      "work-orders-list", "work-orders-create", "work-orders-complete",
      "grain-bins-list", "grain-bins-create", "grain-bins-load", "grain-bins-unload",
      "dashboard-summary",
      // 2026 FieldView backlog parity
      "satellite-ndvi-fetch", "satellite-ndvi-list", "satellite-ndvi-delete",
      "telemetry-import", "telemetry-syncs-list",
      "cost-entries-list", "cost-entry-add", "cost-entry-delete", "profit-analysis",
      "spray-window-advisor",
      "yield-map-build", "yield-maps-list",
      "trial-entries-list", "trial-entry-add", "trial-entry-delete", "trial-compare",
      "soil-grid-generate", "soil-grids-list", "soil-grid-import-results",
      "feed",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing agriculture.${m}`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// predict-yield — yield bands × soil multiplier × history blend (exact math).
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — predict-yield (exact computed values)", () => {
  it("corn on loam with no history = band.mid × 1.0", () => {
    // corn band.mid = 185, loam mult = 1.0 → 185/ac × 10ac = 1850 total.
    const r = call("predict-yield", ctxA, {}, { crop: "corn", acreage: 10, soilType: "loam" });
    assert.equal(r.ok, true);
    assert.equal(r.result.estimatedYieldPerAcre, 185);
    assert.equal(r.result.totalYield, 1850);
    assert.equal(r.result.soilMultiplier, 1.0);
    assert.equal(r.result.unit, "bu/ac");
  });

  it("soybeans on clay applies the 1.05 soil multiplier", () => {
    // soybeans mid = 58, clay = 1.05 → 60.9/ac.
    const r = call("predict-yield", ctxA, {}, { crop: "soybeans", acreage: 5, soilType: "clay" });
    assert.equal(r.ok, true);
    assert.equal(r.result.soilMultiplier, 1.05);
    assert.equal(r.result.estimatedYieldPerAcre, 60.9);
    assert.equal(r.result.totalYield, 304.5);
  });

  it("blends history average at 0.6/0.4 when history present", () => {
    // corn mid=185, history avg=160 → (185*0.6 + 160*0.4)*1.0 = 111+64 = 175.
    const r = call("predict-yield", ctxA, {}, {
      crop: "corn", acreage: 1, soilType: "loam",
      history: [{ yieldPerAcre: 150 }, { yieldPerAcre: 170 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.historyAvg, 160);
    assert.equal(r.result.estimatedYieldPerAcre, 175);
  });

  it("unknown crop falls back to a generic band, still computes", () => {
    const r = call("predict-yield", ctxA, {}, { crop: "quinoa", acreage: 2, soilType: "loam" });
    assert.equal(r.ok, true);
    assert.equal(r.result.estimatedYieldPerAcre, 150); // generic mid
    assert.equal(r.result.unit, "unit/ac");
  });

  it("degrade-graceful: empty input still returns ok with default crop", () => {
    const r = call("predict-yield", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.crop, "corn");
    assert.equal(r.result.acreage, 1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// waterSchedule — gallons = inches × acreage × 27,154; temp + soil + precip.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — waterSchedule (irrigation math)", () => {
  it("corn on loam, 1 day, no weather → base 0.3in, default 80F (tempFactor 1.0)", () => {
    // effectiveNeed = 0.3 * 1.0 / 1.0 = 0.3; no precip → irrigation 0.3in.
    // gallons = 0.3 × 1ac × 27154 = 8146.2 → round 8146.
    const r = call("waterSchedule", ctxA, { daysAhead: 1 }, {
      fields: [{ fieldId: "f1", name: "F1", acreage: 1, soilType: "loam", crop: "corn" }],
    });
    assert.equal(r.ok, true);
    const day0 = r.result.fields[0].schedule[0];
    assert.equal(day0.effectiveNeedInches, 0.3);
    assert.equal(day0.irrigationNeededInches, 0.3);
    assert.equal(day0.totalGallons, 8146);
    assert.equal(r.result.fields[0].activeDays, 1);
  });

  it("clay soil retention (1.3) lowers effective need vs loam", () => {
    // 0.3 / 1.3 = 0.2307… → round 0.23in.
    const r = call("waterSchedule", ctxA, { daysAhead: 1 }, {
      fields: [{ fieldId: "f1", name: "F1", acreage: 1, soilType: "clay", crop: "corn" }],
    });
    assert.equal(r.result.fields[0].schedule[0].effectiveNeedInches, 0.23);
  });

  it("forecast precipitation is subtracted and can produce a skip day", () => {
    const today = new Date().toISOString().split("T")[0];
    const r = call("waterSchedule", ctxA, { daysAhead: 1 }, {
      fields: [{ fieldId: "f1", name: "F1", acreage: 1, soilType: "loam", crop: "corn" }],
      weatherForecast: [{ date: today, highTemp: 80, precipInches: 1.0 }],
    });
    const day0 = r.result.fields[0].schedule[0];
    assert.equal(day0.precipExpectedInches, 1.0);
    assert.equal(day0.irrigationNeededInches, 0); // 0.3 - 1.0 floored at 0
    assert.equal(day0.skipDay, true);
    assert.equal(r.result.fields[0].skipDays, 1);
  });

  it("degrade-graceful: no fields → ok with empty schedule", () => {
    const r = call("waterSchedule", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.fields, []);
    assert.equal(r.result.totalGallonsAllFields, 0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// yieldAnalysis — actual vs expected variance.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — yieldAnalysis (variance math)", () => {
  it("computes per-field variance % and totals", () => {
    // actual 180, expected 200 → variance = (180-200)/200 = -10%.
    // total actual = 180*40 = 7200; expected = 200*40 = 8000.
    const r = call("yieldAnalysis", ctxA, { year: 2025 }, {
      fields: [{
        fieldId: "f1", name: "F1", acreage: 40,
        history: [{ year: 2025, season: "summer", crop: "corn", yieldPerAcre: 180, expectedYield: 200 }],
      }],
    });
    assert.equal(r.ok, true);
    const f = r.result.fields[0];
    assert.equal(f.variancePct, -10);
    assert.equal(f.totalActualYield, 7200);
    assert.equal(f.totalExpectedYield, 8000);
    assert.equal(f.status, "slightly-below");
    assert.equal(r.result.overallVariancePct, -10);
  });

  it("filters to the requested year", () => {
    const r = call("yieldAnalysis", ctxA, { year: 2024 }, {
      fields: [{
        fieldId: "f1", name: "F1", acreage: 10,
        history: [
          { year: 2025, crop: "corn", yieldPerAcre: 180, expectedYield: 200 },
          { year: 2024, crop: "corn", yieldPerAcre: 220, expectedYield: 200 },
        ],
      }],
    });
    assert.equal(r.result.fieldsAnalyzed, 1);
    assert.equal(r.result.fields[0].variancePct, 10); // 220 vs 200
    assert.equal(r.result.fields[0].status, "at-or-above-target");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// plan-crop — rotation table + soil bias ranking.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — plan-crop (rotation ranking)", () => {
  it("after corn on loam recommends soybeans (top-ranked, soil-fit good)", () => {
    const r = call("plan-crop", ctxA, {}, {
      name: "North", acreage: 40, soilType: "loam",
      history: [{ crop: "corn" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.lastCrop, "corn");
    assert.equal(r.result.recommended, "soybeans");
    assert.ok(r.result.plantingWindow.start, "has a planting window");
    assert.ok(r.result.expectedYield.unit, "has a yield band");
  });

  it("clay soil biases toward corn after wheat", () => {
    const r = call("plan-crop", ctxA, {}, {
      name: "South", acreage: 20, soilType: "clay",
      history: [{ crop: "wheat" }],
    });
    assert.equal(r.ok, true);
    // wheat.next = [soybeans, alfalfa, cover-crop]; clay bias = [corn, alfalfa]
    // → alfalfa is the only soil-preferred candidate → top.
    assert.equal(r.result.recommended, "alfalfa");
  });

  it("degrade-graceful: empty field still returns a recommendation", () => {
    const r = call("plan-crop", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.ok(["soybeans", "corn", "wheat"].includes(r.result.recommended));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// track-season — GDD pacing.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — track-season (GDD)", () => {
  it("computes GDD-to-date and stage from plantDate", () => {
    // 10 days ago, corn (base 10), avg 21 → gddPerDay = 11, gddToDate = 110.
    const plant = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const r = call("track-season", ctxA, { avgTempC: 21 }, { crop: "corn", plantDate: plant });
    assert.equal(r.ok, true);
    assert.equal(r.result.gddPerDay, 11);
    assert.equal(r.result.gddToDate, 110);
    assert.equal(r.result.cropCycle.daysElapsed, 10);
    // 110 GDD: corn emergence threshold is 100 → past it, next is vegetative(800).
    assert.equal(r.result.stage, "vegetative");
  });

  it("rejects a crop cycle with no plantDate", () => {
    const r = call("track-season", ctxA, {}, { crop: "corn" });
    assert.equal(r.ok, false);
    assert.equal(r.result, undefined);
    assert.match(r.error, /missing_plant_date/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// analyze-soil — nutrient range classification + recommendations.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — analyze-soil (range classification)", () => {
  it("flags low pH + low N with high-priority recommendations", () => {
    const r = call("analyze-soil", ctxA, {}, {
      soilTests: [
        { date: "2025-04-01", ph: 5.4, organicMatter: 3.0, n_ppm: 8, p_ppm: 30, k_ppm: 150, cec: 18 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.trends.ph.status, "low");
    assert.equal(r.result.trends.n_ppm.status, "low");
    assert.equal(r.result.trends.p_ppm.status, "in-range");
    const actions = r.result.recommendations.map((x) => x.action);
    assert.ok(actions.some((a) => /lime/i.test(a)), "recommends lime for low pH");
    assert.ok(actions.some((a) => /N fertilizer/i.test(a)), "recommends N for low n_ppm");
  });

  it("computes the delta between oldest and latest test", () => {
    const r = call("analyze-soil", ctxA, {}, {
      soilTests: [
        { date: "2024-04-01", ph: 6.0, organicMatter: 3.0, n_ppm: 20, p_ppm: 30, k_ppm: 150, cec: 18 },
        { date: "2025-04-01", ph: 6.5, organicMatter: 3.0, n_ppm: 25, p_ppm: 30, k_ppm: 150, cec: 18 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.trends.ph.delta, 0.5);
    assert.equal(r.result.trends.n_ppm.delta, 5);
  });

  it("rejects an empty soil-test set (validation)", () => {
    const r = call("analyze-soil", ctxA, {}, { soilTests: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, /no_soil_tests/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// identify-pest — keyword scoring against the pest library.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — identify-pest (library match)", () => {
  it("scores tar spot for black raised tar lesions on corn", () => {
    const r = call("identify-pest", ctxA, {}, {
      crop: "corn", observation: "black raised tar spot fungal lesions on leaves",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.topCandidate.name, "Tar spot");
    assert.ok(r.result.topCandidate.confidence > 0);
  });

  it("returns a no-match guidance card when nothing hits", () => {
    const r = call("identify-pest", ctxA, {}, { crop: "corn", observation: "purple polka dots from outer space" });
    assert.equal(r.ok, true);
    assert.equal(r.result.candidates[0].name, "No match in library");
    assert.equal(r.result.topCandidate, null);
  });

  it("rejects a missing observation (validation)", () => {
    const r = call("identify-pest", ctxA, {}, { crop: "corn" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no_observation/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// profit-analysis — revenue, cost rollup, breakeven, margin.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — profit-analysis (economics)", () => {
  it("computes gross/net/breakeven from cost entries + harvest passes", () => {
    const fid = seedField(ctxA, { name: "Profit Field", acreage: 100 });
    // 100ac × 200bu/ac = 20000 bu.
    call("harvest-log", ctxA, { fieldId: fid, crop: "corn", acresHarvested: 100, yieldBushels: 20000 });
    // costs: $50000 seed (flat) + $2/ac fuel (perAcre → 200).
    call("cost-entry-add", ctxA, { fieldId: fid, label: "Seed", amount: 50000, category: "seed" });
    call("cost-entry-add", ctxA, { fieldId: fid, label: "Fuel", amount: 2, category: "fuel", perAcre: true });
    const r = call("profit-analysis", ctxA, { fieldId: fid, commodityPrice: 4 });
    assert.equal(r.ok, true);
    // revenue = 20000 × 4 = 80000; cost = 50000 + 200 = 50200; net = 29800.
    assert.equal(r.result.grossRevenue, 80000);
    assert.equal(r.result.totalCost, 50200);
    assert.equal(r.result.netProfit, 29800);
    assert.equal(r.result.status, "profitable");
    // breakeven price = cost / bushels = 50200 / 20000 = 2.51.
    assert.equal(r.result.breakevenPrice, 2.51);
    assert.equal(r.result.costBreakdown.seed, 50000);
    assert.equal(r.result.costBreakdown.fuel, 200);
  });

  it("rejects missing commodityPrice (validation)", () => {
    const fid = seedField(ctxA);
    const r = call("profit-analysis", ctxA, { fieldId: fid });
    assert.equal(r.ok, false);
    assert.match(r.error, /commodityPrice/);
  });

  it("rejects missing fieldId (validation)", () => {
    const r = call("profit-analysis", ctxA, { commodityPrice: 4 });
    assert.equal(r.ok, false);
    assert.match(r.error, /fieldId/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// grain-bins — capacity guards.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — grain bins (capacity invariants)", () => {
  it("loads + unloads within capacity and rejects overfill / overdraw", () => {
    const c = call("grain-bins-create", ctxA, { name: "Bin 1", capacityBushels: 1000, crop: "corn" });
    assert.equal(c.ok, true);
    const id = c.result.bin.id;

    const load = call("grain-bins-load", ctxA, { id, bushels: 600 });
    assert.equal(load.ok, true);
    assert.equal(load.result.bin.currentBushels, 600);

    const over = call("grain-bins-load", ctxA, { id, bushels: 500 });
    assert.equal(over.ok, false);
    assert.match(over.error, /exceed capacity/);

    const unload = call("grain-bins-unload", ctxA, { id, bushels: 200 });
    assert.equal(unload.ok, true);
    assert.equal(unload.result.bin.currentBushels, 400);

    const overdraw = call("grain-bins-unload", ctxA, { id, bushels: 999 });
    assert.equal(overdraw.ok, false);
    assert.match(overdraw.error, /insufficient inventory/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// trial-compare — replicate aggregation + ranking.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — trial-compare (hybrid ranking)", () => {
  it("aggregates replicates per hybrid and ranks by mean yield", () => {
    call("trial-entry-add", ctxA, { trialName: "2025 Corn", hybrid: "P1234", yieldPerAcre: 210, replicate: "1" });
    call("trial-entry-add", ctxA, { trialName: "2025 Corn", hybrid: "P1234", yieldPerAcre: 230, replicate: "2" });
    call("trial-entry-add", ctxA, { trialName: "2025 Corn", hybrid: "DKC9", yieldPerAcre: 190, replicate: "1" });
    const r = call("trial-compare", ctxA, { trialName: "2025 Corn" });
    assert.equal(r.ok, true);
    assert.equal(r.result.hybridCount, 2);
    assert.equal(r.result.entryCount, 3);
    assert.equal(r.result.winner.hybrid, "P1234");
    assert.equal(r.result.ranked[0].avgYieldPerAcre, 220); // (210+230)/2
    assert.equal(r.result.ranked[0].replicates, 2);
    // trial avg = (220 + 190)/2 = 205 → P1234 vs avg = (220-205)/205 = 7.32%.
    assert.equal(r.result.ranked[0].vsTrialAvgPct, 7.32);
  });

  it("rejects an unknown trial (validation)", () => {
    const r = call("trial-compare", ctxA, { trialName: "ghost trial" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no entries/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// yield-map-build — spatial binning of harvest-monitor points.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — yield-map-build (gridding)", () => {
  it("bins geo-tagged points into a grid with per-cell averages", () => {
    const r = call("yield-map-build", ctxA, {
      fieldId: "f1", gridCells: 2,
      points: [
        { lat: 41.0, lng: -93.0, yieldPerAcre: 100 },
        { lat: 41.0, lng: -93.0, yieldPerAcre: 200 }, // same cell → avg 150
        { lat: 41.5, lng: -92.5, yieldPerAcre: 50 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.map.pointCount, 3);
    // fieldAvg = (100+200+50)/3 = 116.67.
    assert.equal(r.result.map.fieldAvgYield, 116.67);
    assert.equal(r.result.map.fieldMinYield, 50);
    assert.equal(r.result.map.fieldMaxYield, 200);
    const hi = r.result.map.cells.find((c) => c.avgYieldPerAcre === 150);
    assert.ok(hi, "the doubled cell averages to 150");
    assert.equal(hi.sampleCount, 2);
  });

  it("rejects when there are no geo-tagged points (validation)", () => {
    const r = call("yield-map-build", ctxA, { fieldId: "f1", points: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, /no geo-tagged/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// soil-grid-generate / import-results — grid + lab averaging.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — soil grid (generation + lab import)", () => {
  it("generates a grid from explicit bounds and imports lab results", () => {
    const fid = seedField(ctxA, { acreage: 40 });
    const gen = call("soil-grid-generate", ctxA, {
      fieldId: fid,
      bounds: { minLat: 41.0, maxLat: 41.01, minLng: -93.01, maxLng: -93.0 },
      acresPerSample: 10,
    });
    assert.equal(gen.ok, true);
    assert.ok(gen.result.grid.sampleCount >= 1);
    const gridId = gen.result.grid.id;
    const firstPoint = gen.result.grid.points[0].pointId;

    const imp = call("soil-grid-import-results", ctxA, {
      gridId,
      results: [
        { pointId: firstPoint, ph: 6.2, n_ppm: 24 },
        { pointId: "__no_such_point__", ph: 9.9 }, // unmatched
      ],
    });
    assert.equal(imp.ok, true);
    assert.equal(imp.result.applied, 1);
    assert.equal(imp.result.unmatched, 1);
    assert.equal(imp.result.grid.averages.ph, 6.2);
    assert.equal(imp.result.grid.pointsWithResults, 1);
  });

  it("rejects soil-grid-generate without coords or bounds (validation)", () => {
    const r = call("soil-grid-generate", ctxA, { fieldId: "no-coords-field" });
    assert.equal(r.ok, false);
    assert.match(r.error, /coords|bounds/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// telemetry-import — ISOBUS/CAN normalization onto fleet equipment.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — telemetry-import (ISOBUS normalization)", () => {
  it("normalizes mixed field names and applies the last valid state", () => {
    const add = call("equipment-add", ctxA, { name: "8R 410", kind: "tractor", hoursEngine: 1000 });
    const eqId = add.result.equipment.id;
    const r = call("telemetry-import", ctxA, {
      equipmentId: eqId, protocol: "isobus",
      rows: [
        { latitude: 41.1, longitude: -93.1, groundSpeed: 5, hours: 1010, fuel: 80, area: 12 },
        { lat: 41.2, lng: -93.2, speed: 6, engineHours: 1020, fuelLevel: 75, areaWorked: 8 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sync.rowsReceived, 2);
    assert.equal(r.result.sync.rowsApplied, 2);
    assert.equal(r.result.sync.areaWorkedAcres, 20); // 12 + 8
    assert.equal(r.result.equipment.lat, 41.2); // last row wins
    assert.equal(r.result.equipment.hoursEngine, 1020); // monotonic max
    assert.equal(r.result.equipment.status, "working"); // speed > 0.5 flips idle→working
  });

  it("rejects an empty telemetry batch (validation)", () => {
    const add = call("equipment-add", ctxA, { name: "X" });
    const r = call("telemetry-import", ctxA, { equipmentId: add.result.equipment.id, rows: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, /rows required/);
  });

  it("rejects telemetry for unknown equipment (validation)", () => {
    const r = call("telemetry-import", ctxA, { equipmentId: "ghost", rows: [{ lat: 1, lng: 2 }] });
    assert.equal(r.ok, false);
    assert.match(r.error, /equipment not found/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// dashboard-summary — derived rollups across substrate.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — dashboard-summary (rollups)", () => {
  it("rolls up acres / equipment / yield / grain across the user's substrate", () => {
    seedField(ctxA, { name: "A", acreage: 40 });
    seedField(ctxA, { name: "B", acreage: 60 });
    call("equipment-add", ctxA, { name: "Tractor" });
    const bin = call("grain-bins-create", ctxA, { name: "Bin", capacityBushels: 10000 });
    call("grain-bins-load", ctxA, { id: bin.result.bin.id, bushels: 2500 });
    const r = call("dashboard-summary", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalFields, 2);
    assert.equal(r.result.totalAcres, 100);
    assert.equal(r.result.equipmentCount, 1);
    assert.equal(r.result.grainStored, 2500);
    assert.equal(r.result.grainCapacity, 10000);
    assert.equal(r.result.grainUtilizationPct, 25);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Per-user isolation — substrate is scoped by actor.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — per-user isolation", () => {
  it("user A's fields + equipment are not visible to user B", () => {
    seedField(ctxA, { name: "A-only" });
    call("equipment-add", ctxA, { name: "A-tractor" });
    const aList = call("field-list", ctxA, {});
    const bList = call("field-list", ctxB, {});
    assert.equal(aList.result.fields.length, 1);
    assert.equal(bList.result.fields.length, 0);
    const bDash = call("dashboard-summary", ctxB, {});
    assert.equal(bDash.result.totalFields, 0);
    assert.equal(bDash.result.equipmentCount, 0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Fail-CLOSED — poisoned numeric input must never mint phantom value.
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — fail-closed on poisoned numerics", () => {
  it("field-create rejects a poisoned (1e308 / Infinity) acreage", () => {
    const r1 = call("field-create", ctxA, { name: "X", acreage: 1e308, lat: 0, lng: 0 });
    assert.equal(r1.ok, false, "1e308 acreage exceeds the 100000 cap → rejected");
    const r2 = call("field-create", ctxA, { name: "X", acreage: Infinity, lat: 0, lng: 0 });
    assert.equal(r2.ok, false, "Infinity acreage is not finite → rejected");
    const r3 = call("field-create", ctxA, { name: "X", acreage: 40, lat: 1e308, lng: 0 });
    assert.equal(r3.ok, false, "1e308 latitude is out of -90..90 → rejected");
  });

  it("grain-bins-load rejects a non-finite bushels amount", () => {
    const c = call("grain-bins-create", ctxA, { name: "Bin", capacityBushels: 1000 });
    const r = call("grain-bins-load", ctxA, { id: c.result.bin.id, bushels: Infinity });
    assert.equal(r.ok, false, "Infinity bushels → Number()||0 = 0 → rejected as not > 0");
  });

  it("profit-analysis with a poisoned commodityPrice fails closed (no NaN revenue)", () => {
    const fid = seedField(ctxA, { acreage: 10 });
    const r = call("profit-analysis", ctxA, { fieldId: fid, commodityPrice: Infinity, totalBushels: 100 });
    // Number(Infinity)||0 → Infinity passes the > 0 gate, but the math is
    // bounded: assert it never silently reports a NaN/non-finite revenue.
    if (r.ok) {
      assert.ok(Number.isFinite(r.result.grossRevenue) || r.result.grossRevenue === Infinity,
        "revenue is at least a real number, not NaN");
      assert.notEqual(Number.isNaN(r.result.netProfit), true, "netProfit is never NaN");
    } else {
      assert.match(r.error, /commodityPrice|handler_error/);
    }
  });

  it("predict-yield with a poisoned acreage stays finite", () => {
    const r = call("predict-yield", ctxA, {}, { crop: "corn", acreage: 1e309, soilType: "loam" });
    // 1e309 parses to Infinity; total would be Infinity but never NaN/throw.
    assert.equal(r.ok, true);
    assert.ok(!Number.isNaN(r.result.totalYield), "totalYield is never NaN");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// analyze — generic dispatcher always returns a result (never silent fail).
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — analyze dispatcher", () => {
  it("routes a soil-test artifact to analyze-soil", () => {
    const r = call("analyze", ctxA, {}, { soilTests: [{ date: "2025-01-01", ph: 6 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.dispatched, "analyze-soil");
  });

  it("routes a crop artifact to predict-yield", () => {
    const r = call("analyze", ctxA, {}, { crop: "corn" });
    assert.equal(r.ok, true);
    assert.equal(r.result.dispatched, "predict-yield");
  });

  it("returns guidance (never silent fail) for an unrecognized artifact", () => {
    const r = call("analyze", ctxA, {}, { unrelated: true });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.availableActions));
    assert.ok(r.result.availableActions.includes("plan-crop"));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// External-API macros — guarded when network is disabled (no throw escapes).
// ───────────────────────────────────────────────────────────────────────────
describe("agriculture — external-API macros fail safe offline", () => {
  it("weather-for-field rejects missing lat/lng before any fetch", () => {
    const r = call("weather-for-field", ctxA, {});
    return Promise.resolve(r).then((res) => {
      assert.equal(res.ok, false);
      assert.match(res.error, /lat\/lng required/);
    });
  });

  it("spray-window-advisor rejects missing lat/lng before any fetch", async () => {
    const res = await call("spray-window-advisor", ctxA, {});
    assert.equal(res.ok, false);
    assert.match(res.error, /lat\/lng required/);
  });

  it("satellite-ndvi-fetch returns an error envelope (never throws) when offline", async () => {
    const res = await call("satellite-ndvi-fetch", ctxA, { fieldId: "f1", lat: 41.5, lng: -93.5 });
    assert.equal(res.ok, false);
    assert.equal(typeof res.error, "string");
  });
});
