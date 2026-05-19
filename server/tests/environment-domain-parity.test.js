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
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
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

// ── Full-app parity (Watershed + Persefoni 2026 carbon accounting) ──

describe("environment.emission-factors-* (real EPA factors)", () => {
  it("list returns Scope 1/2/3 split with sources", () => {
    const r = call("emission-factors-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.factors.length >= 20);
    assert.ok(r.result.scopes.scope1 > 0);
    assert.ok(r.result.scopes.scope2 > 0);
    assert.ok(r.result.scopes.scope3 > 0);
    assert.match(r.result.source, /EPA/);
  });
  it("lookup returns single factor with EPA citation", () => {
    const r = call("emission-factors-lookup", ctxA, { key: "diesel_gallon" });
    assert.equal(r.ok, true);
    assert.equal(r.result.scope, 1);
    assert.equal(r.result.co2e, 10.21);
    assert.match(r.result.source, /EPA/);
  });
  it("rejects unknown factor key", () => {
    assert.equal(call("emission-factors-lookup", ctxA, { key: "unicorn_kg" }).ok, false);
  });
});

describe("environment.activities-* (Scope 1/2/3 ledger)", () => {
  it("log applies real factor and computes co2eKg/tonnes", () => {
    const r = call("activities-log", ctxA, { factorKey: "diesel_gallon", amount: 100, date: "2026-05-01", facility: "HQ" });
    assert.equal(r.ok, true);
    assert.equal(r.result.activity.scope, 1);
    // 100 gal × 10.21 kg/gal = 1021 kg = 1.021 tonnes
    assert.ok(Math.abs(r.result.activity.co2eKg - 1021) < 0.1);
    assert.ok(Math.abs(r.result.activity.co2eTonnes - 1.02) < 0.01);
  });
  it("filters by scope and year", () => {
    call("activities-log", ctxA, { factorKey: "diesel_gallon", amount: 50, date: "2026-01-01" });
    call("activities-log", ctxA, { factorKey: "electricity_kwh_us_avg", amount: 5000, date: "2026-01-01" });
    call("activities-log", ctxA, { factorKey: "air_travel_long_haul_passenger_mile", amount: 10000, date: "2025-01-01" });
    assert.equal(call("activities-list", ctxA, { scope: 1 }).result.activities.length, 1);
    assert.equal(call("activities-list", ctxA, { scope: 2 }).result.activities.length, 1);
    assert.equal(call("activities-list", ctxA, { year: "2025" }).result.activities.length, 1);
  });
  it("rejects unknown factor and zero amount", () => {
    assert.equal(call("activities-log", ctxA, { factorKey: "nope", amount: 1 }).ok, false);
    assert.equal(call("activities-log", ctxA, { factorKey: "diesel_gallon", amount: 0 }).ok, false);
  });
});

describe("environment.suppliers-* (Scope 3 portal)", () => {
  it("add / invite / record disclosure cycle", () => {
    const a = call("suppliers-add", ctxA, { name: "Acme Manufacturing", email: "sustainability@acme.com", spendUsd: 500000 });
    assert.equal(a.ok, true);
    assert.equal(a.result.supplier.invitationStatus, "not_invited");
    const inv = call("suppliers-invite", ctxA, { id: a.result.supplier.id });
    assert.equal(inv.result.supplier.invitationStatus, "invited");
    assert.match(inv.result.portalLink, /supplier-portal/);
    const disc = call("suppliers-record-disclosure", ctxA, { id: a.result.supplier.id, co2eTonnes: 1240.5, year: "2026" });
    assert.equal(disc.result.supplier.invitationStatus, "responded");
    assert.equal(disc.result.supplier.reportedCo2eTonnes, 1240.5);
  });
  it("rejects negative tonnes", () => {
    const a = call("suppliers-add", ctxA, { name: "X", email: "x@x" });
    assert.equal(call("suppliers-record-disclosure", ctxA, { id: a.result.supplier.id, co2eTonnes: -1 }).ok, false);
  });
});

describe("environment.targets-* (SBTi-shape)", () => {
  it("create with framework + scopes + computed targetCo2eTonnes", () => {
    const r = call("targets-create", ctxA, { name: "2030 50%", baseYear: 2020, targetYear: 2030, baseCo2eTonnes: 1000, reductionPct: 50, scopes: [1, 2], framework: "sbti_1.5c" });
    assert.equal(r.ok, true);
    assert.equal(r.result.target.targetCo2eTonnes, 500);
    assert.equal(r.result.target.framework, "sbti_1.5c");
  });
  it("progress reports on-track / off-track relative to expected pace", () => {
    const t = call("targets-create", ctxA, { name: "T", baseYear: 2020, targetYear: 2030, baseCo2eTonnes: 1000, reductionPct: 50, scopes: [1] });
    const r = call("targets-progress", ctxA, { id: t.result.target.id });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.onTrack === "boolean");
    assert.ok(typeof r.result.gapToTarget === "number");
  });
});

describe("environment.projects-* (reduction projects)", () => {
  it("create / update-status cycle", () => {
    const p = call("projects-create", ctxA, { name: "Solar rooftop", expectedReductionTonnesPerYear: 80, costUsd: 250000, paybackYears: 7 });
    assert.equal(p.ok, true);
    assert.equal(p.result.project.status, "proposed");
    const u = call("projects-update-status", ctxA, { id: p.result.project.id, status: "in_progress" });
    assert.equal(u.result.project.status, "in_progress");
  });
});

describe("environment.recs-* (renewable energy certificates)", () => {
  it("purchase / retire cycle with registry + serial", () => {
    const p = call("recs-purchase", ctxA, { mwh: 500, tech: "solar", registry: "WREGIS", vintage: "2026", pricePerMwhUsd: 3.5 });
    assert.equal(p.ok, true);
    assert.match(p.result.rec.certificateNumber, /^REC-/);
    const r = call("recs-retire", ctxA, { id: p.result.rec.id, reason: "Scope 2 market-based reduction" });
    assert.equal(r.result.rec.status, "retired");
  });
  it("rejects double-retirement", () => {
    const p = call("recs-purchase", ctxA, { mwh: 100, tech: "wind" });
    call("recs-retire", ctxA, { id: p.result.rec.id });
    assert.equal(call("recs-retire", ctxA, { id: p.result.rec.id }).ok, false);
  });
});

describe("environment.offsets-* (carbon offsets)", () => {
  it("purchase / retire cycle with serial", () => {
    const p = call("offsets-purchase", ctxA, { tonnes: 100, project: "Brazil REDD+ Acre", kind: "forestry_redd", registry: "Verra_VCS", vintage: "2024", pricePerTonneUsd: 12 });
    assert.equal(p.ok, true);
    assert.match(p.result.offset.serialNumber, /^OFF-/);
    const r = call("offsets-retire", ctxA, { id: p.result.offset.id });
    assert.equal(r.result.offset.status, "retired");
  });
  it("rejects double-retirement", () => {
    const p = call("offsets-purchase", ctxA, { tonnes: 50, kind: "direct_air_capture" });
    call("offsets-retire", ctxA, { id: p.result.offset.id });
    assert.equal(call("offsets-retire", ctxA, { id: p.result.offset.id }).ok, false);
  });
});

describe("environment.epa-ejscreen + noaa-climate-stations (real APIs)", () => {
  it("ejscreen rejects missing coords", async () => {
    const r = await call("epa-ejscreen", ctxA, {});
    assert.equal(r.ok, false);
  });
  it("noaa returns config error when token missing", async () => {
    delete process.env.NOAA_CDO_TOKEN;
    const r = await call("noaa-climate-stations", ctxA, { lat: 42, lng: -71 });
    assert.equal(r.ok, false);
    assert.match(r.error, /NOAA_CDO_TOKEN/);
  });
});

describe("environment.dashboard-summary", () => {
  it("aggregates YTD scope 1/2/3 + suppliers + RECs + offsets + net", () => {
    const ctxC = { actor: { userId: "user_env_dash" }, userId: "user_env_dash" };
    const yr = new Date().getFullYear().toString();
    call("activities-log", ctxC, { factorKey: "diesel_gallon", amount: 100, date: `${yr}-01-01` });
    call("activities-log", ctxC, { factorKey: "electricity_kwh_us_avg", amount: 10000, date: `${yr}-01-01` });
    call("activities-log", ctxC, { factorKey: "air_travel_long_haul_passenger_mile", amount: 20000, date: `${yr}-01-01` });
    const sup = call("suppliers-add", ctxC, { name: "S", email: "s@x" });
    call("suppliers-invite", ctxC, { id: sup.result.supplier.id });
    call("suppliers-record-disclosure", ctxC, { id: sup.result.supplier.id, co2eTonnes: 50 });
    call("targets-create", ctxC, { name: "T", baseYear: 2020, targetYear: 2030, baseCo2eTonnes: 100, reductionPct: 50 });
    const off = call("offsets-purchase", ctxC, { tonnes: 5, kind: "direct_air_capture" });
    call("offsets-retire", ctxC, { id: off.result.offset.id });
    const d = call("dashboard-summary", ctxC, {});
    assert.equal(d.ok, true);
    assert.ok(d.result.ytdScope1 > 0);
    assert.ok(d.result.ytdScope2 > 0);
    assert.ok(d.result.ytdScope3 > 0);
    assert.equal(d.result.supplierResponseRate, 100);
    assert.equal(d.result.activeTargets, 1);
    assert.equal(d.result.offsetsRetiredTonnes, 5);
    assert.equal(d.result.netEmissionsTonnes, Math.round((d.result.ytdTotalCo2eTonnes - 5) * 100) / 100);
  });
});
