// Behavioral macro tests for server/domains/urbanplanning.js — the Esri-Urban /
// US-Census-shaped planning substrate the /lenses/urban-planning lens drives.
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150): handlers
// registered through the PATH-3 domainModules convention
// (server/domains/index.js → server.js:41408) are 3-arg
// `registerLensAction(domain, action, (ctx, artifact, params))`, and the
// dispatcher invokes `handler(ctx, virtualArtifact, input)` where
// `virtualArtifact = { id:null, domain:"urban-planning", type:"domain_action",
// data:input, meta:{} }`. Several urban-planning handlers read their input from
// `artifact.data` (zoning/walkability/density/traffic/massing/impact/transit),
// others from the 3rd `params` arg (parcels/scenarios/comments/export/census).
// Our harness passes BOTH `virtualArtifact.data = input` AND `input` as the 3rd
// arg, so a regression that confuses the param positions surfaces here.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed
// values: the zoning FAR → maxBuildable math, the walkability category folding,
// the density classification thresholds, the trip-generation traffic model, the
// 3D massing envelope (footprint → floors → GFA → dwelling units → population →
// emissions), the scenario-compare best/total reductions, the transit walk-shed
// catchment area + point-in-circle parcel coverage, and per-user isolation of
// the persistent workspace. Validation-rejection paths and a poisoned-numeric
// fail-CLOSED case (Infinity/NaN/1e308 never reach a computed total) are pinned.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerUrbanplanningActions from "../domains/urbanplanning.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "urban-planning", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input). The
// virtualArtifact carries `data:input` (some handlers read artifact.data), and
// `input` is also passed as the 3rd param (others read params).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`urban-planning.${name} not registered`);
  const virtualArtifact = {
    id: null,
    domain: "urban-planning",
    type: "domain_action",
    data: input || {},
    meta: {},
  };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerUrbanplanningActions(registerLensAction); });
// Each test starts from a clean persistent workspace (the lens keeps parcels /
// scenarios / comments in globalThis._concordSTATE.urbanPlanningLens).
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("urban-planning — registration (every lens-driven macro present)", () => {
  it("registers all 20 macros the page + children call", () => {
    for (const m of [
      // pure-compute calculators
      "zoningAnalysis", "walkabilityScore", "densityCalc", "trafficImpact",
      // real external-API demographics
      "census-acs-county", "hud-income-limits",
      // persistent workspace
      "parcel-add", "parcel-list", "parcel-remove",
      "massingEnvelope",
      "scenario-create", "scenario-list", "scenario-remove", "scenario-compare",
      "impactDashboard", "transitCoverage",
      "comment-add", "comment-list", "comment-resolve",
      "exportPlan",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing urban-planning.${m}`);
    }
  });
});

describe("urban-planning — zoningAnalysis (FAR → buildable math, reads artifact.data)", () => {
  it("commercial zone applies FAR 2.0 to the lot size exactly", () => {
    const r = call("zoningAnalysis", ctxA, { zoneType: "commercial", lotSizeSqFt: 10000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.zoneType, "commercial");
    assert.equal(r.result.floorAreaRatio, 2.0);
    assert.equal(r.result.maxBuildableSqFt, 20000, "10000 * 2.0 FAR");
    assert.equal(r.result.maxHeight, "60 ft");
    assert.equal(r.result.density, "medium");
  });

  it("an unknown zone falls back to residential FAR 0.5", () => {
    const r = call("zoningAnalysis", ctxA, { zoneType: "spaceport", lotSizeSqFt: 8000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.zoneType, "spaceport");
    assert.equal(r.result.floorAreaRatio, 0.5);
    assert.equal(r.result.maxBuildableSqFt, 4000, "8000 * 0.5 residential default");
  });

  it("degrades graceful on empty input (default residential 5000 sqft)", () => {
    const r = call("zoningAnalysis", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.zoneType, "residential");
    assert.equal(r.result.maxBuildableSqFt, 2500, "5000 default * 0.5");
  });

  it("fail-CLOSED on poisoned lot size — never emits a non-finite buildable area", () => {
    for (const poison of [Infinity, NaN, "1e400", -1, "9".repeat(40)]) {
      const r = call("zoningAnalysis", ctxA, { zoneType: "mixed", lotSizeSqFt: poison });
      assert.equal(r.ok, true, `still ok for poison=${String(poison)}`);
      assert.equal(
        Number.isFinite(r.result.maxBuildableSqFt), true,
        `maxBuildableSqFt finite for poison=${String(poison)} (got ${r.result.maxBuildableSqFt})`,
      );
      // a non-positive or non-numeric lot collapses to 0 buildable, never Infinity/NaN.
      assert.ok(r.result.maxBuildableSqFt >= 0);
    }
  });
});

describe("urban-planning — walkabilityScore (category folding, reads artifact.data)", () => {
  it("scores a within-walking-distance amenity set on the 0–100 scale", () => {
    const amenities = [
      { category: "grocery", withinWalkingDistance: true },
      { category: "restaurant", withinWalkingDistance: true },
      { category: "transit", withinWalkingDistance: true },
      { category: "park", withinWalkingDistance: false },
    ];
    const r = call("walkabilityScore", ctxA, { amenities });
    assert.equal(r.ok, true);
    // grocery 1 + restaurant 1 + transit 1 + park 0.3 = 3.3 over maxPoints (7*2=14)
    // → round(3.3/14*100) = round(23.57) = 24 (24 < 25 → almost-all-errands).
    assert.equal(r.result.walkabilityScore, 24);
    assert.equal(r.result.rating, "almost-all-errands-require-car");
    assert.equal(r.result.totalAmenities, 4);
    assert.equal(r.result.amenityScores.grocery, 1);
    assert.equal(r.result.amenityScores.park, 0.3);
  });

  it("an unknown amenity category is ignored (not counted)", () => {
    const r = call("walkabilityScore", ctxA, {
      amenities: [{ category: "spaceport", withinWalkingDistance: true }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.walkabilityScore, 0);
    assert.equal(r.result.totalAmenities, 1);
  });

  it("empty amenity list scores 0 and degrades graceful", () => {
    const r = call("walkabilityScore", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.walkabilityScore, 0);
    assert.equal(r.result.rating, "almost-all-errands-require-car");
  });
});

describe("urban-planning — densityCalc (classification thresholds, reads artifact.data)", () => {
  it("classifies an urban-core density and rail viability", () => {
    const r = call("densityCalc", ctxA, {
      population: 120000, areaSqMiles: 10, housingUnits: 55000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.populationDensity, "12000/sq mi");
    assert.equal(r.result.housingDensity, "5500 units/sq mi");
    assert.equal(r.result.classification, "urban-core", ">10000 → urban-core");
    assert.equal(r.result.transitViability, "supports-rail", ">5000 → rail");
  });

  it("classifies a rural density and car-dependence", () => {
    const r = call("densityCalc", ctxA, { population: 500, areaSqMiles: 1, housingUnits: 200 });
    assert.equal(r.result.classification, "rural");
    assert.equal(r.result.transitViability, "car-dependent");
  });

  it("avoids divide-by-zero — empty input defaults area to 1 sq mi", () => {
    const r = call("densityCalc", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.populationDensity, "0/sq mi");
    assert.ok(Number.isFinite(parseInt(r.result.populationDensity)));
  });
});

describe("urban-planning — trafficImpact (trip-generation model, reads artifact.data)", () => {
  it("computes new trips, peak-hour, and a significant impact level", () => {
    const r = call("trafficImpact", ctxA, {
      newHousingUnits: 200, newCommercialSqFt: 50000, currentADT: 10000,
    });
    assert.equal(r.ok, true);
    // 200*8 + 50000*0.01 = 1600 + 500 = 2100 daily trips
    assert.equal(r.result.newDailyTrips, 2100);
    assert.equal(r.result.peakHourTrips, 210, "10% of daily");
    assert.equal(r.result.percentIncrease, 21, "2100/10000 → 21%");
    assert.equal(r.result.impactLevel, "significant", ">10% increase");
    assert.ok(Array.isArray(r.result.mitigation) && r.result.mitigation.length > 1);
  });

  it("a tiny project is minimal impact with the standard-capacity note", () => {
    const r = call("trafficImpact", ctxA, { newHousingUnits: 5, currentADT: 10000 });
    assert.equal(r.result.newDailyTrips, 40);
    assert.equal(r.result.impactLevel, "minimal");
    assert.deepEqual(r.result.mitigation, ["Standard roadway capacity sufficient"]);
  });
});

describe("urban-planning — massingEnvelope (3D build-out, reads artifact.data + params)", () => {
  it("computes the full envelope → yield → emissions chain for a mixed-use lot", () => {
    const r = call("massingEnvelope", ctxA, {
      zoneType: "mixed", lotSizeSqFt: 20000, useMix: "mixed", efficiency: 0.82,
    });
    assert.equal(r.ok, true);
    const m = r.result;
    // mixed: lotCoverage 0.8 → footprint 16000; FAR 3.0 → maxBuildable 60000.
    assert.equal(m.footprintSqFt, 16000);
    assert.equal(m.lotCoveragePct, 80);
    // floors = min(floor(85/11)=7, round(60000/16000)=4) = 4. height 44 ft.
    assert.equal(m.floors, 4);
    assert.equal(m.buildingHeightFt, 44);
    // GFA = 16000*4 = 64000; net = round(64000*0.82) = 52480.
    assert.equal(m.grossFloorAreaSqFt, 64000);
    assert.equal(m.netFloorAreaSqFt, 52480);
    // mixed use → 60% residential. res = round(52480*0.6)=31488; comm 20992.
    // dwelling = round(31488/900)=35; jobs = round(20992/350)=60.
    assert.equal(m.dwellingUnits, 35);
    assert.equal(m.jobs, 60);
    // population = round(35*2.4)=84.
    assert.equal(m.population, 84);
    // emissions = round(35*4.6 + 60*2.1, 1) = round(161 + 126) = 287.
    assert.equal(m.emissionsTonnesPerYear, 287);
    // envelope is a square footprint box of the right height.
    assert.equal(m.envelope.heightFt, 44);
    assert.equal(m.envelope.widthFt, Math.round(Math.sqrt(16000)));
  });

  it("commercial use yields jobs but zero dwellings", () => {
    const r = call("massingEnvelope", ctxA, {
      zoneType: "commercial", lotSizeSqFt: 15000, useMix: "commercial",
    });
    assert.equal(r.result.dwellingUnits, 0);
    assert.ok(r.result.jobs > 0);
    assert.equal(r.result.population, 0);
  });

  it("fail-CLOSED on a poisoned efficiency / lot — every yield number stays finite", () => {
    for (const poison of [Infinity, NaN, "1e400", -5]) {
      const r = call("massingEnvelope", ctxA, {
        zoneType: "residential", lotSizeSqFt: poison, efficiency: poison,
      });
      assert.equal(r.ok, true, `ok for poison=${String(poison)}`);
      for (const k of ["footprintSqFt", "grossFloorAreaSqFt", "dwellingUnits", "jobs", "population", "emissionsTonnesPerYear"]) {
        assert.equal(
          Number.isFinite(r.result[k]), true,
          `${k} finite for poison=${String(poison)} (got ${r.result[k]})`,
        );
        assert.ok(r.result[k] >= 0, `${k} non-negative for poison=${String(poison)}`);
      }
    }
  });
});

describe("urban-planning — parcel workspace (persistent, per-user, CRUD)", () => {
  it("adds, lists, and removes a parcel; rejects a missing apn", () => {
    assert.equal(call("parcel-add", ctxA, {}).error, "parcel apn/parcelId required");
    const add = call("parcel-add", ctxA, {
      apn: "APN-123", address: "1 Plaza", zoneType: "commercial", lotSizeSqFt: 12000,
    });
    assert.equal(add.ok, true);
    assert.equal(add.result.parcel.apn, "APN-123");
    assert.equal(add.result.parcel.zoneType, "commercial");
    assert.equal(add.result.parcel.lotSizeSqFt, 12000);

    const list = call("parcel-list", ctxA, {});
    assert.equal(list.result.parcels.length, 1);
    assert.equal(list.result.parcels[0].apn, "APN-123");

    const rm = call("parcel-remove", ctxA, { id: add.result.parcel.id });
    assert.equal(rm.result.removed, 1);
    assert.equal(call("parcel-list", ctxA, {}).result.parcels.length, 0);
  });

  it("an unknown zone on a parcel falls back to residential", () => {
    const add = call("parcel-add", ctxA, { apn: "X", zoneType: "spaceport" });
    assert.equal(add.result.parcel.zoneType, "residential");
  });

  it("parcels are per-user — A's parcels never appear in B's list", () => {
    call("parcel-add", ctxA, { apn: "A-1" });
    assert.equal(call("parcel-list", ctxA, {}).result.parcels.length, 1);
    assert.equal(call("parcel-list", ctxB, {}).result.parcels.length, 0);
  });
});

describe("urban-planning — scenario workspace + comparison", () => {
  it("creates a scenario, lists it with computed impacts, removes it", () => {
    assert.equal(call("scenario-create", ctxA, {}).error, "scenario name required");
    const c = call("scenario-create", ctxA, {
      name: "Transit Village", zoneType: "mixed", lotSizeSqFt: 20000, useMix: "mixed",
    });
    assert.equal(c.ok, true);
    const list = call("scenario-list", ctxA, {});
    assert.equal(list.result.scenarios.length, 1);
    // scenario-list folds in the same massing math as massingEnvelope.
    assert.equal(list.result.scenarios[0].impacts.dwellingUnits, 35);
    assert.equal(list.result.scenarios[0].impacts.jobs, 60);

    const rm = call("scenario-remove", ctxA, { id: c.result.scenario.id });
    assert.equal(rm.result.removed, 1);
  });

  it("scenario-compare ranks best per metric and totals across scenarios", () => {
    call("scenario-create", ctxA, { name: "Low", zoneType: "residential", lotSizeSqFt: 10000 });
    call("scenario-create", ctxA, { name: "High", zoneType: "mixed", lotSizeSqFt: 40000, useMix: "mixed" });
    const cmp = call("scenario-compare", ctxA, {});
    assert.equal(cmp.ok, true);
    assert.equal(cmp.result.count, 2);
    // The mixed 40k-lot scenario yields the most dwelling units → it is "best".
    const high = cmp.result.scenarios.find((s) => s.name === "High");
    assert.equal(cmp.result.best.dwellingUnits, high.id, "highest-yield is best for units");
    // totals are the sum of both scenarios' computed metric.
    const sumUnits = cmp.result.scenarios.reduce((a, s) => a + s.dwellingUnits, 0);
    assert.equal(cmp.result.totals.dwellingUnits, sumUnits);
    // For emissions, the LOWEST is best (greenest).
    const low = cmp.result.scenarios.find((s) => s.name === "Low");
    const greenest = cmp.result.scenarios.slice().sort(
      (a, b) => a.emissionsTonnesPerYear - b.emissionsTonnesPerYear)[0];
    assert.equal(cmp.result.best.emissionsTonnesPerYear, greenest.id);
    assert.equal(greenest.id, low.id);
  });

  it("scenario-compare with no scenarios rejects (never throws)", () => {
    const cmp = call("scenario-compare", ctxA, {});
    assert.equal(cmp.ok, false);
    assert.equal(cmp.error, "no scenarios to compare");
  });
});

describe("urban-planning — impactDashboard (growth %, jobs-housing balance)", () => {
  it("projects growth vs baseline and the jobs-housing balance band", () => {
    const r = call("impactDashboard", ctxA, {
      zoneType: "mixed", lotSizeSqFt: 40000, useMix: "mixed",
      baselinePopulation: 100, baselineJobs: 50,
    });
    assert.equal(r.ok, true);
    const p = r.result.projections;
    assert.ok(p.population > 0 && p.jobs > 0 && p.housingUnits > 0);
    // growth = projected / baseline * 100, finite.
    assert.ok(Number.isFinite(r.result.populationGrowthPct));
    assert.ok(Number.isFinite(r.result.jobsGrowthPct));
    // jobs-housing ratio = jobs / dwellingUnits, banded.
    assert.equal(r.result.jobsHousingRatio, Math.round((p.jobs / p.housingUnits) * 100) / 100);
    assert.ok(["housing-rich", "balanced", "jobs-rich"].includes(r.result.jobsHousingBalance));
    assert.ok(Number.isFinite(r.result.emissionsPerCapita));
  });

  it("a zero baseline yields null growth % (not Infinity)", () => {
    const r = call("impactDashboard", ctxA, {
      zoneType: "residential", lotSizeSqFt: 10000, baselinePopulation: 0, baselineJobs: 0,
    });
    assert.equal(r.result.populationGrowthPct, null);
    assert.equal(r.result.jobsGrowthPct, null);
  });
});

describe("urban-planning — transitCoverage (walk-shed catchment + point-in-circle)", () => {
  it("computes catchment acres by mode and flags served parcels", () => {
    const r = call("transitCoverage", ctxA, {
      stops: [{ id: "s1", name: "Central", mode: "rail", lat: 37.78, lng: -122.41 }],
      parcels: [
        { id: "p_near", lat: 37.7805, lng: -122.4105 }, // ~ on top of the stop → served
        { id: "p_far", lat: 38.0, lng: -123.0 },         // far away → not served
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.stopCount, 1);
    const c = r.result.catchments[0];
    assert.equal(c.mode, "rail");
    assert.equal(c.radiusMeters, 800, "rail walk-shed = 800m");
    // area = π r² / 4046.86 sqm-per-acre, rounded to 0.1.
    assert.equal(c.catchmentAcres, Math.round((Math.PI * 800 * 800 / 4046.86) * 10) / 10);
    assert.equal(r.result.parcelsEvaluated, 2);
    assert.equal(r.result.parcelsServed, 1, "only the near parcel is inside the 800m circle");
    assert.equal(r.result.parcelCoveragePct, 50);
  });

  it("an unknown mode defaults to the bus walk-shed (400m)", () => {
    const r = call("transitCoverage", ctxA, {
      stops: [{ mode: "hyperloop", lat: 0, lng: 0 }],
    });
    assert.equal(r.result.catchments[0].radiusMeters, 400);
  });

  it("rejects an empty stops set (never throws)", () => {
    const r = call("transitCoverage", ctxA, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "stops array required");
  });
});

describe("urban-planning — public-comment workflow", () => {
  it("adds, lists with a stance tally, and resolves a comment", () => {
    assert.equal(call("comment-add", ctxA, {}).error, "subjectId (project/scenario id) required");
    assert.equal(call("comment-add", ctxA, { subjectId: "scn_1" }).error, "comment body required");
    const a = call("comment-add", ctxA, { subjectId: "scn_1", body: "I support this", stance: "support", author: "Jo" });
    assert.equal(a.ok, true);
    assert.equal(a.result.comment.stance, "support");
    call("comment-add", ctxA, { subjectId: "scn_1", body: "Against", stance: "oppose" });
    call("comment-add", ctxA, { subjectId: "other", body: "Neutral note" });

    const list = call("comment-list", ctxA, { subjectId: "scn_1" });
    assert.equal(list.result.total, 2, "subject filter applies");
    assert.equal(list.result.tally.support, 1);
    assert.equal(list.result.tally.oppose, 1);

    const res = call("comment-resolve", ctxA, { id: a.result.comment.id, status: "addressed" });
    assert.equal(res.result.comment.status, "addressed");
    assert.ok(res.result.comment.resolvedAt);
  });

  it("an invalid stance defaults to neutral; resolving an unknown id is not_found", () => {
    const a = call("comment-add", ctxA, { subjectId: "s", body: "x", stance: "furious" });
    assert.equal(a.result.comment.stance, "neutral");
    assert.equal(call("comment-resolve", ctxA, { id: "ghost" }).error, "comment not found");
  });
});

describe("urban-planning — exportPlan (assembles the persistent workspace)", () => {
  it("rolls parcels + scenarios + comments into a markdown report with counts", () => {
    call("parcel-add", ctxA, { apn: "APN-1", address: "1 St", zoneType: "mixed", lotSizeSqFt: 20000 });
    call("scenario-create", ctxA, { name: "Plan A", zoneType: "mixed", lotSizeSqFt: 20000, useMix: "mixed" });
    call("comment-add", ctxA, { subjectId: "scn", body: "Looks great", stance: "support", author: "Ada" });

    const r = call("exportPlan", ctxA, { title: "Downtown Vision" });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "markdown");
    assert.equal(r.result.counts.parcels, 1);
    assert.equal(r.result.counts.scenarios, 1);
    assert.equal(r.result.counts.comments, 1);
    assert.match(r.result.reportText, /# Downtown Vision/);
    assert.match(r.result.reportText, /APN-1/);
    assert.match(r.result.reportText, /Plan A/);
    assert.match(r.result.reportText, /Looks great/);
  });

  it("empty workspace exports a valid (zero-count) report, never throws", () => {
    const r = call("exportPlan", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.counts.parcels, 0);
    assert.equal(r.result.counts.scenarios, 0);
    assert.equal(r.result.title, "Urban Plan Report");
  });
});

describe("urban-planning — census-acs-county / hud-income-limits (deterministic guards, NO network)", () => {
  it("census rejects malformed FIPS BEFORE any fetch", async () => {
    const r = await call("census-acs-county", ctxA, { stateFips: "6", countyFips: "75x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /stateFips \(2 digits\) \+ countyFips \(3 digits\) required/);
  });

  it("census rejects an over-long stateFips BEFORE any fetch (pads to 3 digits → regex fail)", async () => {
    // A 3-digit state code pads to "123" which fails the /^\d{2}$/ guard, so the
    // handler returns the validation error WITHOUT touching the network.
    const r = await call("census-acs-county", ctxA, { stateFips: "123", countyFips: "001" });
    assert.equal(r.ok, false);
    assert.match(r.error, /stateFips \(2 digits\) \+ countyFips \(3 digits\) required/);
  });

  it("hud-income-limits fails CLOSED without HUD_API_TOKEN (no fetch attempted)", async () => {
    const prev = process.env.HUD_API_TOKEN;
    delete process.env.HUD_API_TOKEN;
    try {
      const r = await call("hud-income-limits", ctxA, { stateAbbr: "CA" });
      assert.equal(r.ok, false);
      assert.match(r.error, /HUD_API_TOKEN env required/);
    } finally {
      if (prev !== undefined) process.env.HUD_API_TOKEN = prev;
    }
  });

  it("hud-income-limits with a token but a bad state-abbr rejects before fetch", async () => {
    const prev = process.env.HUD_API_TOKEN;
    process.env.HUD_API_TOKEN = "test-token";
    try {
      const r = await call("hud-income-limits", ctxA, { stateAbbr: "California" });
      assert.equal(r.ok, false);
      assert.match(r.error, /stateAbbr \(2-letter\) required/);
    } finally {
      if (prev !== undefined) process.env.HUD_API_TOKEN = prev;
      else delete process.env.HUD_API_TOKEN;
    }
  });
});

describe("urban-planning — STATE-unavailable degrade (workspace macros never throw)", () => {
  it("returns a guarded error (never throws) when global STATE is absent", () => {
    const saved = globalThis._concordSTATE;
    // getUpState() returns null when STATE is falsy → guarded { ok:false }.
    globalThis._concordSTATE = null;
    try {
      for (const m of ["parcel-list", "scenario-list", "comment-list", "exportPlan"]) {
        const r = call(m, ctxA, {});
        assert.equal(r.ok, false, `${m} guarded`);
        assert.equal(r.error, "STATE unavailable");
      }
    } finally {
      globalThis._concordSTATE = saved;
    }
  });
});
