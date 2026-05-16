// Contract tests for server/domains/nonprofit.js — pure-compute
// donor/grant/volunteer/campaign macros plus real ProPublica Nonprofit
// Explorer (IRS 990) integration.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerNonprofitActions from "../domains/nonprofit.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`nonprofit.${name}`);
  if (!fn) throw new Error(`nonprofit.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerNonprofitActions(register); });

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("nonprofit.donorRetention", () => {
  it("computes retention rate between consecutive years", () => {
    const history = [
      { donorId: "alice", date: "2025-03-01" },
      { donorId: "bob", date: "2025-04-15" },
      { donorId: "alice", date: "2026-02-10" },
      { donorId: "carol", date: "2026-05-01" },
    ];
    const r = call("donorRetention", ctxA, { data: { givingHistory: history } }, { year: 2026 });
    assert.equal(r.ok, true);
    // alice retained, bob lapsed → 1/2 = 50%
    assert.equal(r.result.retentionRate, 50);
    assert.equal(r.result.retained, 1);
    assert.equal(r.result.priorTotal, 2);
  });
});

describe("nonprofit.campaignProgress", () => {
  it("computes percent + projected total", () => {
    const start = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const end = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const r = call("campaignProgress", ctxA, {
      title: "Build the Library",
      data: { goalAmount: 100_000, raisedAmount: 30_000, donorCount: 120, startDate: start, endDate: end },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.percentComplete, 30);
    assert.ok(r.result.projected >= 50_000 && r.result.projected <= 70_000);
  });
});

describe("nonprofit.lookup-org-by-ein (ProPublica Nonprofit Explorer)", () => {
  it("rejects missing EIN", async () => {
    const r = await call("lookup-org-by-ein", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /ein required/);
  });

  it("rejects bad EIN length", async () => {
    const r = await call("lookup-org-by-ein", ctxA, { ein: "123" });
    assert.equal(r.ok, false);
    assert.match(r.error, /9 digits/);
  });

  it("strips non-digits (handles 13-1234567 hyphenated EINs)", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ organization: { ein: "131234567", name: "X", subsection_code: 3 }, filings_with_data: [] }) };
    };
    await call("lookup-org-by-ein", ctxA, { ein: "13-1234567" });
    assert.match(capturedUrl, /organizations\/131234567\.json/);
  });

  it("hits ProPublica and shapes the real response", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        organization: {
          ein: "530196605",
          name: "AMERICAN RED CROSS",
          address: "431 18TH ST NW", city: "WASHINGTON", state: "DC", zipcode: "20006-5310",
          ntee_code: "M20",
          ntee_classification: "Disaster Preparedness and Relief Service",
          ruling_date: "1938-12-01T00:00:00.000-05:00",
          subsection_code: 3,
          deductibility: 1,
          asset_amount: 4123456789,
          income_amount: 3000000000,
          revenue_amount: 3100000000,
        },
        filings_with_data: [
          { tax_prd: 202206, tax_prd_yr: 2022, totrevenue: 3000000000, totfuncexpns: 2900000000, totassetsend: 4123456789, pdf_url: "https://example.org/990.pdf" },
        ],
      }),
    });
    const r = await call("lookup-org-by-ein", ctxA, { ein: "530196605" });
    assert.equal(r.ok, true);
    assert.equal(r.result.name, "AMERICAN RED CROSS");
    assert.equal(r.result.address.city, "WASHINGTON");
    assert.equal(r.result.taxExemptStatus, "501(c)(3)");
    assert.equal(r.result.deductible, true);
    assert.equal(r.result.rulingYear, 1938);
    assert.equal(r.result.filings.length, 1);
    assert.equal(r.result.filings[0].netIncome, 100000000);
    assert.equal(r.result.source, "propublica-nonprofit-explorer");
  });

  it("returns clear 404 when EIN doesn't exist", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("lookup-org-by-ein", ctxA, { ein: "999999999" });
    assert.equal(r.ok, false);
    assert.match(r.error, /EIN not found/);
  });
});

describe("nonprofit.search-orgs (ProPublica search)", () => {
  it("rejects short queries", async () => {
    assert.equal((await call("search-orgs", ctxA, { query: "a" })).ok, false);
  });

  it("hits ProPublica search and shapes the result list", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          total_results: 2, num_pages: 1, cur_page: 0,
          organizations: [
            { ein: "530196605", name: "AMERICAN RED CROSS", city: "WASHINGTON", state: "DC", ntee_code: "M20", score: 18.0, ruling_date: "1938-12-01T00:00:00" },
            { ein: "131635294", name: "DOCTORS WITHOUT BORDERS USA INC", city: "NEW YORK", state: "NY", ntee_code: "Q33", score: 14.5, ruling_date: "1990-04-01T00:00:00" },
          ],
        }),
      };
    };
    const r = await call("search-orgs", ctxA, { query: "red cross", state: "DC" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /search\.json\?q=red%20cross/);
    assert.match(capturedUrl, /state%5Bid%5D=DC/);
    assert.equal(r.result.totalResults, 2);
    assert.equal(r.result.orgs[0].ein, "530196605");
    assert.equal(r.result.orgs[1].rulingYear, 1990);
    assert.equal(r.result.source, "propublica-nonprofit-explorer");
  });

  it("surfaces propublica network failures", async () => {
    const r = await call("search-orgs", ctxA, { query: "abc" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/);
  });
});
