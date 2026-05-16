// Contract tests for server/domains/environment.js — pure-compute
// helpers plus real EPA Envirofacts + USGS Water Services + AirNow.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEnvironmentActions from "../domains/environment.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`environment.${name}`);
  if (!fn) throw new Error(`environment.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerEnvironmentActions(register); });
beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.AIRNOW_API_KEY;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("environment.populationTrend (pure)", () => {
  it("detects increasing trend", () => {
    const r = call("populationTrend", ctxA, {
      data: { surveyData: [{ date: "2024-01", count: 100 }, { date: "2026-01", count: 150 }] },
    }, {});
    assert.equal(r.result.trend, "increasing");
    assert.equal(r.result.changePercent, 50);
  });
});

describe("environment.epa-superfund-search", () => {
  it("rejects invalid state", async () => {
    assert.equal((await call("epa-superfund-search", ctxA, {})).ok, false);
    assert.equal((await call("epa-superfund-search", ctxA, { state: "X" })).ok, false);
  });

  it("hits Envirofacts + shapes site response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([
          {
            SITE_ID: "CAD980498077",
            SITE_NAME: "STRINGFELLOW",
            CITY_NAME: "GLEN AVON",
            STATE_CODE: "CA",
            ZIP_CODE: "92509",
            COUNTY_NAME: "RIVERSIDE",
            NPL_STATUS_NAME: "Final NPL",
            PRIMARY_LATITUDE: "33.9963",
            PRIMARY_LONGITUDE: "-117.4750",
            FEDERAL_FACILITY_IND: "N",
            EPA_REGION_CODE: "09",
          },
        ]),
      };
    };
    const r = await call("epa-superfund-search", ctxA, { state: "CA", city: "Glen Avon" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /data\.epa\.gov\/efservice\/SEMS\.SEMS_NPL_VW\/STATE_CODE\/CA/);
    assert.match(capturedUrl, /CITY_NAME\/=\/GLEN%20AVON/);
    assert.equal(r.result.sites[0].siteName, "STRINGFELLOW");
    assert.equal(r.result.sites[0].latitude, 33.9963);
    assert.equal(r.result.source, "epa-envirofacts-sems");
  });
});

describe("environment.usgs-water-realtime", () => {
  it("rejects missing/bad siteCode", async () => {
    assert.equal((await call("usgs-water-realtime", ctxA, {})).ok, false);
    assert.equal((await call("usgs-water-realtime", ctxA, { siteCode: "abc" })).ok, false);
  });

  it("hits USGS Water + parses time-series shape", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          value: {
            queryInfo: { note: [{}, {}, {}, { value: "2026-05-16T17:42:00Z" }] },
            timeSeries: [
              {
                sourceInfo: {
                  siteName: "RUSSIAN R NR GUERNEVILLE CA",
                  siteCode: [{ value: "11467000" }],
                  geoLocation: { geogLocation: { latitude: 38.5093, longitude: -122.9277 } },
                },
                variable: {
                  variableName: "Streamflow, ft³/s",
                  variableDescription: "Discharge, cubic feet per second",
                  unit: { unitCode: "ft3/s" },
                  variableCode: [{ value: "00060" }],
                },
                values: [{ value: [{ value: "412.5", dateTime: "2026-05-16T17:30:00.000-07:00", qualifiers: ["P"] }] }],
              },
            ],
          },
        }),
      };
    };
    const r = await call("usgs-water-realtime", ctxA, { siteCode: "11467000" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /waterservices\.usgs\.gov\/nwis\/iv/);
    assert.match(capturedUrl, /sites=11467000/);
    assert.match(capturedUrl, /parameterCd=00060,00065/);  // default streamflow + gauge
    assert.equal(r.result.readings.length, 1);
    assert.equal(r.result.readings[0].siteName, "RUSSIAN R NR GUERNEVILLE CA");
    assert.equal(r.result.readings[0].latestValue, 412.5);
    assert.equal(r.result.readings[0].pcode, "00060");
    assert.equal(r.result.source, "usgs-water-services");
  });

  it("supports custom pcodes", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ value: { timeSeries: [] } }) };
    };
    await call("usgs-water-realtime", ctxA, { siteCode: "11467000", parameters: "00010,00045" });
    assert.match(capturedUrl, /parameterCd=00010,00045/);
  });
});

describe("environment.airnow-current", () => {
  it("rejects missing key", async () => {
    const r = await call("airnow-current", ctxA, { zipCode: "94110" });
    assert.equal(r.ok, false);
    assert.match(r.error, /AIRNOW_API_KEY/);
  });

  it("rejects missing location params", async () => {
    process.env.AIRNOW_API_KEY = "test-key";
    const r = await call("airnow-current", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /zipCode.*latitude/);
  });

  it("hits AirNow zipCode endpoint + shapes the AQI list", async () => {
    process.env.AIRNOW_API_KEY = "test-key";
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([
          {
            DateObserved: "2026-05-16",
            HourObserved: 14, LocalTimeZone: "PST",
            ReportingArea: "Oakland", StateCode: "CA",
            Latitude: 37.8, Longitude: -122.27,
            ParameterName: "OZONE", AQI: 52, Category: { Name: "Moderate", Number: 2 },
          },
        ]),
      };
    };
    const r = await call("airnow-current", ctxA, { zipCode: "94110" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /airnowapi\.org\/aq\/observation\/zipCode\/current/);
    assert.match(capturedUrl, /zipCode=94110/);
    assert.match(capturedUrl, /API_KEY=test-key/);
    assert.equal(r.result.observations[0].aqi, 52);
    assert.equal(r.result.observations[0].category, "Moderate");
    assert.equal(r.result.source, "epa-airnow");
  });

  it("surfaces 401 invalid-key clearly", async () => {
    process.env.AIRNOW_API_KEY = "bad";
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const r = await call("airnow-current", ctxA, { zipCode: "94110" });
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid/);
  });
});
