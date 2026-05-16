// Contract tests for hr (BLS) + defense (USAspending DoD) real-data macros.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHRActions from "../domains/hr.js";
import registerDefenseActions from "../domains/defense.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerHRActions(register);
  registerDefenseActions(register);
});

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.BLS_API_KEY;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("hr.bls-series-lookup (Bureau of Labor Statistics)", () => {
  it("rejects missing seriesId", async () => {
    assert.equal((await call("hr.bls-series-lookup", ctxA, {})).ok, false);
  });

  it("rejects > 50 series", async () => {
    const seriesIds = Array.from({ length: 51 }, (_, i) => `LNS${String(i).padStart(8, "0")}`);
    assert.equal((await call("hr.bls-series-lookup", ctxA, { seriesIds })).ok, false);
  });

  it("POSTs to BLS + parses unemployment-rate series", async () => {
    let capturedUrl = "", capturedBody = null;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          status: "REQUEST_SUCCEEDED",
          Results: {
            series: [{
              seriesID: "LNS14000000",
              data: [
                { year: "2026", period: "M03", periodName: "March", value: "3.8", footnotes: [] },
                { year: "2026", period: "M02", periodName: "February", value: "3.9", footnotes: [] },
              ],
            }],
          },
        }),
      };
    };
    const r = await call("hr.bls-series-lookup", ctxA, { seriesId: "LNS14000000", startYear: 2025, endYear: 2026 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.bls\.gov\/publicAPI\/v2\/timeseries\/data/);
    assert.deepEqual(capturedBody.seriesid, ["LNS14000000"]);
    assert.equal(capturedBody.startyear, "2025");
    assert.equal(capturedBody.endyear, "2026");
    assert.equal(r.result.series[0].data[0].value, 3.8);
    assert.equal(r.result.authenticated, false);
    assert.equal(r.result.source, "bls-public-api-v2");
  });

  it("includes registrationkey when BLS_API_KEY env set", async () => {
    process.env.BLS_API_KEY = "real-key";
    let capturedBody = null;
    globalThis.fetch = async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ status: "REQUEST_SUCCEEDED", Results: { series: [] } }) };
    };
    const r = await call("hr.bls-series-lookup", ctxA, { seriesId: "LNS14000000" });
    assert.equal(capturedBody.registrationkey, "real-key");
    assert.equal(r.result.authenticated, true);
  });

  it("surfaces BLS in-body error status", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ status: "REQUEST_NOT_PROCESSED", message: ["Invalid series ID"] }),
    });
    const r = await call("hr.bls-series-lookup", ctxA, { seriesId: "INVALID" });
    assert.equal(r.ok, false);
    assert.match(r.error, /Invalid series ID/);
  });
});

describe("defense.usaspending-dod-contracts", () => {
  it("rejects empty keyword", async () => {
    assert.equal((await call("defense.usaspending-dod-contracts", ctxA, {})).ok, false);
  });

  it("POSTs to USAspending + filters by DoD agency", async () => {
    let capturedUrl = "", capturedBody = null;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          page_metadata: { total: 4 },
          results: [{
            "Award ID": "GS-35F-0119Y",
            "Recipient Name": "ACME DEFENSE CONTRACTING INC",
            "Award Amount": 12_500_000,
            "Awarding Agency": "Department of Defense",
            "Awarding Sub Agency": "Department of the Navy",
            Description: "Satellite communications hardware",
            "Period of Performance Start Date": "2024-09-01",
            "Period of Performance Current End Date": "2027-08-31",
            "NAICS code": "517410",
            "PSC code": "5820",
            "Place of Performance State Code": "VA",
          }],
        }),
      };
    };
    const r = await call("defense.usaspending-dod-contracts", ctxA, { keyword: "satellite", limit: 25 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.usaspending\.gov\/api\/v2\/search\/spending_by_award/);
    // DoD agency filter present
    assert.equal(capturedBody.filters.agencies[0].name, "Department of Defense");
    // Default = contracts → award_type_codes A,B,C,D
    assert.deepEqual(capturedBody.filters.award_type_codes, ["A", "B", "C", "D"]);
    assert.equal(r.result.results[0].recipient, "ACME DEFENSE CONTRACTING INC");
    assert.equal(r.result.results[0].amount, 12_500_000);
    assert.equal(r.result.totalAmount, 12_500_000);
    assert.equal(r.result.source, "usaspending.gov");
  });

  it("switches award_type_codes for grants/loans/idvs", async () => {
    let capturedBody = null;
    globalThis.fetch = async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ results: [] }) };
    };
    await call("defense.usaspending-dod-contracts", ctxA, { keyword: "x", awardType: "grants" });
    assert.deepEqual(capturedBody.filters.award_type_codes, ["02", "03", "04", "05"]);
    await call("defense.usaspending-dod-contracts", ctxA, { keyword: "x", awardType: "loans" });
    assert.deepEqual(capturedBody.filters.award_type_codes, ["07", "08"]);
  });
});
