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
