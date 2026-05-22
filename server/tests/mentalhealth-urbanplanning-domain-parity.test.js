// Contract tests for mental-health (crisis hotlines + CDC BRFSS) +
// urban-planning (Census ACS + HUD Income Limits) real-data macros.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMentalhealthActions from "../domains/mentalhealth.js";
import registerUrbanplanningActions from "../domains/urbanplanning.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  // The Esri-parity macros persist per-user data into globalThis._concordSTATE.
  if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
  registerMentalhealthActions(register);
  registerUrbanplanningActions(register);
});

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.CENSUS_API_KEY;
  delete process.env.HUD_API_TOKEN;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("mental-health.crisis-hotlines (static authoritative reference)", () => {
  it("returns full US hotline table by default", () => {
    const r = call("mental-health.crisis-hotlines", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.country, "US");
    assert.equal(r.result.available, true);
    assert.equal(r.result.hotlines.primary.phone, "988");
    assert.equal(r.result.hotlines.primary.text, "988");
    assert.match(r.result.hotlines.primary.chat, /988lifeline\.org/);
    assert.equal(r.result.hotlines.veterans.text, "838255");
    assert.equal(r.result.hotlines.lgbtq.phone, "1-866-488-7386");
    assert.match(r.result.disclaimer, /immediate danger/);
  });

  it("supports UK / CA / AU country codes", () => {
    assert.equal(call("mental-health.crisis-hotlines", ctxA, { country: "UK" }).result.hotlines.primary.name, "Samaritans");
    assert.equal(call("mental-health.crisis-hotlines", ctxA, { country: "CA" }).result.hotlines.primary.phone, "988");
    assert.equal(call("mental-health.crisis-hotlines", ctxA, { country: "AU" }).result.hotlines.primary.phone, "13 11 14");
  });

  it("returns findahelpline.com fallback for unknown country", () => {
    const r = call("mental-health.crisis-hotlines", ctxA, { country: "ZZ" });
    assert.equal(r.result.available, false);
    assert.match(r.result.fallback, /findahelpline\.com/);
  });
});

describe("mental-health.cdc-mental-health-stats", () => {
  it("rejects bad state code", async () => {
    assert.equal((await call("mental-health.cdc-mental-health-stats", ctxA, { locationAbbr: "CAL" })).ok, false);
  });

  it("filters response to MHLTH + DEPRESSION measures", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([
          { year: "2023", stateabbr: "CA", statedesc: "California", measureid: "MHLTH", data_value: "14.2", low_confidence_limit: "13.9", high_confidence_limit: "14.6" },
          { year: "2023", stateabbr: "CA", statedesc: "California", measureid: "DEPRESSION", data_value: "18.5", low_confidence_limit: "18.1", high_confidence_limit: "18.9" },
          { year: "2023", stateabbr: "CA", statedesc: "California", measureid: "OBESITY", data_value: "27.3", low_confidence_limit: "26.9", high_confidence_limit: "27.8" },
        ]),
      };
    };
    const r = await call("mental-health.cdc-mental-health-stats", ctxA, { locationAbbr: "CA", year: 2023 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /data\.cdc\.gov\/resource\/dttw-5yxu/);
    assert.match(capturedUrl, /year='2023'/);
    assert.match(capturedUrl, /stateabbr='CA'/);
    // Only MHLTH + DEPRESSION should pass the filter
    assert.equal(r.result.measures.length, 2);
    assert.ok(r.result.measures.some((m) => m.measure === "frequent-mental-distress"));
    assert.ok(r.result.measures.some((m) => m.measure === "depression-prevalence"));
    assert.equal(r.result.source, "cdc-brfss-places");
  });
});

describe("urban-planning.census-acs-county", () => {
  it("rejects bad FIPS format", async () => {
    assert.equal((await call("urban-planning.census-acs-county", ctxA, {})).ok, false);
    assert.equal((await call("urban-planning.census-acs-county", ctxA, { stateFips: "6" })).ok, false);
  });

  it("hits Census ACS + parses headers/values + computes percentages", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([
          ["B01003_001E", "B19013_001E", "B01002_001E", "B15003_022E", "B15003_001E", "B25003_002E", "B25003_003E", "B08303_001E", "B08303_013E", "NAME", "state", "county"],
          ["873965", "126187", "40.4", "120000", "600000", "150000", "200000", "400000", "60000", "San Francisco County, California", "06", "075"],
        ]),
      };
    };
    const r = await call("urban-planning.census-acs-county", ctxA, { stateFips: "06", countyFips: "075" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.census\.gov\/data\/2023\/acs\/acs5/);
    assert.match(capturedUrl, /for=county:075/);
    assert.match(capturedUrl, /in=state:06/);
    assert.equal(r.result.countyName, "San Francisco County, California");
    assert.equal(r.result.totalPopulation, 873965);
    assert.equal(r.result.medianHouseholdIncome, 126187);
    // bachelors: 120000 / 600000 = 20%
    assert.equal(r.result.bachelorsPlusPct, 20);
    // owners 150k / (150k + 200k) = 42.857... → 42.9
    assert.ok(Math.abs(r.result.ownerOccupiedPct - 42.9) < 0.2);
    // long commute: 60k / 400k = 15%
    assert.equal(r.result.longCommutePct, 15);
    assert.equal(r.result.source, "census-acs-5year");
  });

  it("appends CENSUS_API_KEY when set", async () => {
    process.env.CENSUS_API_KEY = "test-key";
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ([["NAME"], ["X"]]) };
    };
    await call("urban-planning.census-acs-county", ctxA, { stateFips: "06", countyFips: "075" });
    assert.match(capturedUrl, /key=test-key/);
  });
});

describe("urban-planning.hud-income-limits", () => {
  it("rejects missing token", async () => {
    const r = await call("urban-planning.hud-income-limits", ctxA, { stateAbbr: "CA" });
    assert.equal(r.ok, false);
    assert.match(r.error, /HUD_API_TOKEN/);
  });

  it("rejects bad state code", async () => {
    process.env.HUD_API_TOKEN = "test";
    assert.equal((await call("urban-planning.hud-income-limits", ctxA, { stateAbbr: "CAL" })).ok, false);
  });

  it("sends Bearer auth + parses income limits", async () => {
    process.env.HUD_API_TOKEN = "real-token";
    let capturedAuth = "";
    globalThis.fetch = async (_url, opts) => {
      capturedAuth = opts?.headers?.Authorization || "";
      return {
        ok: true,
        json: async () => ({
          data: {
            area_name: "California (Statewide)",
            median_income: 95000,
            very_low: 47500,
            extremely_low: 28500,
            low: 76000,
          },
        }),
      };
    };
    const r = await call("urban-planning.hud-income-limits", ctxA, { stateAbbr: "CA" });
    assert.equal(r.ok, true);
    assert.equal(capturedAuth, "Bearer real-token");
    assert.equal(r.result.medianIncome, 95000);
    assert.equal(r.result.veryLowIncome50Pct, 47500);
    assert.equal(r.result.source, "hud-income-limits");
  });

  it("surfaces 401 invalid-key clearly", async () => {
    process.env.HUD_API_TOKEN = "bad";
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const r = await call("urban-planning.hud-income-limits", ctxA, { stateAbbr: "CA" });
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid/);
  });
});

// ─── Esri Urban parity macros — scenarios, parcels, massing, impacts ───

describe("urban-planning.massingEnvelope (3D build-out envelope)", () => {
  it("computes floors / footprint / yield from zone + lot", () => {
    const r = call("urban-planning.massingEnvelope", ctxA, {
      zoneType: "mixed", lotSizeSqFt: 20000, useMix: "mixed",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.zoneType, "mixed");
    assert.ok(r.result.floors >= 1);
    assert.ok(r.result.grossFloorAreaSqFt > 0);
    assert.ok(r.result.dwellingUnits >= 0);
    assert.ok(r.result.envelope && r.result.envelope.heightFt > 0);
  });

  it("residential lots yield no jobs", () => {
    const r = call("urban-planning.massingEnvelope", ctxA, {
      zoneType: "residential", lotSizeSqFt: 10000, useMix: "residential",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.jobs, 0);
    assert.ok(r.result.dwellingUnits > 0);
  });
});

describe("urban-planning.parcel CRUD", () => {
  it("adds, lists, then removes a parcel scoped to the user", () => {
    const add = call("urban-planning.parcel-add", ctxA, {
      apn: "TEST-0001", address: "100 Main St", zoneType: "commercial",
      lotSizeSqFt: 8000, lat: 37.77, lng: -122.41,
    });
    assert.equal(add.ok, true);
    assert.equal(add.result.parcel.apn, "TEST-0001");
    const id = add.result.parcel.id;

    const list = call("urban-planning.parcel-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.ok(list.result.parcels.some((p) => p.id === id));

    const rm = call("urban-planning.parcel-remove", ctxA, { id });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.removed, 1);
  });

  it("rejects a parcel with no APN", () => {
    const r = call("urban-planning.parcel-add", ctxA, { lotSizeSqFt: 5000 });
    assert.equal(r.ok, false);
  });
});

describe("urban-planning.scenario lifecycle + comparison", () => {
  it("creates scenarios, lists them with impacts, compares, removes", () => {
    const a = call("urban-planning.scenario-create", ctxA, {
      name: "Scenario A", zoneType: "residential", lotSizeSqFt: 15000,
    });
    const b = call("urban-planning.scenario-create", ctxA, {
      name: "Scenario B", zoneType: "mixed", lotSizeSqFt: 15000,
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);

    const list = call("urban-planning.scenario-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.ok(list.result.scenarios.length >= 2);
    assert.ok(list.result.scenarios[0].impacts);

    const cmp = call("urban-planning.scenario-compare", ctxA, {});
    assert.equal(cmp.ok, true);
    assert.ok(cmp.result.count >= 2);
    assert.ok(Array.isArray(cmp.result.metrics));
    assert.ok(cmp.result.best && cmp.result.totals);

    for (const sc of list.result.scenarios) {
      const rm = call("urban-planning.scenario-remove", ctxA, { id: sc.id });
      assert.equal(rm.ok, true);
    }
  });

  it("rejects a scenario with no name", () => {
    assert.equal(call("urban-planning.scenario-create", ctxA, {}).ok, false);
  });

  it("compare with no scenarios returns an error", () => {
    const r = call("urban-planning.scenario-compare", ctxA, {});
    assert.equal(r.ok, false);
  });
});

describe("urban-planning.impactDashboard", () => {
  it("projects population/jobs/housing/emissions + jobs-housing balance", () => {
    const r = call("urban-planning.impactDashboard", ctxA, {
      zoneType: "mixed", lotSizeSqFt: 40000, useMix: "mixed",
      baselinePopulation: 1000, baselineJobs: 400,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.projections.population >= 0);
    assert.ok(r.result.projections.emissionsTonnesPerYear >= 0);
    assert.ok(["balanced", "housing-rich", "jobs-rich", "n/a"]
      .includes(r.result.jobsHousingBalance));
    assert.notEqual(r.result.populationGrowthPct, null);
  });
});

describe("urban-planning.transitCoverage (walk-shed catchments)", () => {
  it("buffers stops + counts parcels inside any catchment", () => {
    const r = call("urban-planning.transitCoverage", ctxA, {
      stops: [
        { id: "s1", name: "Central Rail", mode: "rail", lat: 37.7749, lng: -122.4194 },
        { id: "s2", name: "Bus Hub", mode: "bus", lat: 37.7760, lng: -122.4180 },
      ],
      parcels: [
        { id: "p1", lat: 37.7750, lng: -122.4195 },
        { id: "p2", lat: 38.5, lng: -121.0 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.stopCount, 2);
    assert.equal(r.result.parcelsEvaluated, 2);
    assert.equal(r.result.parcelsServed, 1);
    assert.ok(r.result.catchments[0].radiusMeters > 0);
  });

  it("rejects an empty stops array", () => {
    assert.equal(call("urban-planning.transitCoverage", ctxA, { stops: [] }).ok, false);
  });
});

describe("urban-planning.comment workflow", () => {
  it("adds, lists with tally, then resolves a stakeholder comment", () => {
    const add = call("urban-planning.comment-add", ctxA, {
      subjectId: "scn_demo", author: "Resident", stance: "oppose",
      body: "Too much traffic for the corridor.",
    });
    assert.equal(add.ok, true);
    assert.equal(add.result.comment.stance, "oppose");
    const id = add.result.comment.id;

    const list = call("urban-planning.comment-list", ctxA, { subjectId: "scn_demo" });
    assert.equal(list.ok, true);
    assert.ok(list.result.total >= 1);
    assert.ok(list.result.tally.oppose >= 1);

    const res = call("urban-planning.comment-resolve", ctxA, { id, status: "addressed" });
    assert.equal(res.ok, true);
    assert.equal(res.result.comment.status, "addressed");
  });

  it("rejects a comment with no subjectId or no body", () => {
    assert.equal(call("urban-planning.comment-add", ctxA, { body: "x" }).ok, false);
    assert.equal(call("urban-planning.comment-add", ctxA, { subjectId: "s" }).ok, false);
  });
});

describe("urban-planning.exportPlan", () => {
  it("emits a markdown report with section counts", () => {
    call("urban-planning.scenario-create", ctxA, {
      name: "Export Scenario", zoneType: "mixed", lotSizeSqFt: 12000,
    });
    const r = call("urban-planning.exportPlan", ctxA, { title: "City Plan 2026" });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "markdown");
    assert.match(r.result.reportText, /# City Plan 2026/);
    assert.ok(r.result.counts && typeof r.result.counts.scenarios === "number");
  });
});
