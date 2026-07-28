// Contract tests for the new `law.patent-claims` macro — real patent
// CLAIMS TEXT via USPTO PatentsView's PatentSearch API (`g_claim` +
// `g_patent` entities), closing docs/lens-specs/law-capability-map.md's
// patent-claims-text gap. Same mock-fetch pattern as
// server/tests/law-citation-graph.test.js (network to
// search.patentsview.org is disabled in this sandbox) — no live network
// calls anywhere in this file.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLawActions from "../domains/law.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";


// external-fetch.js routes through the SSRF guard (lib/public-fetch.js), so
// stubbing globalThis.fetch alone no longer intercepts anything -- the guard
// does a real DNS lookup first and fails on a fake hostname. Install
// public-fetch's documented module-scope test transport and delegate to
// whatever globalThis.fetch currently is, so each test's existing stub and
// restore lifecycle keeps working unchanged. Production never calls this.
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
__setPublicFetchTestTransport((url, init) => globalThis.fetch(url, init));

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`law.${name}`);
  if (!fn) throw new Error(`law.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerLawActions(register); });
beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.PATENTSVIEW_API_KEY;
  clearExternalFetchCache();
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

// A realistic g_claim fixture — one independent claim (sequence 0, no
// dependent parent) and one dependent claim (sequence 1, depends on 1).
function claimFixture() {
  return {
    error: false,
    count: 2,
    total_hits: 2,
    g_claim: [
      {
        patent_id: "10000000",
        claim_id: "10000000-1",
        claim_sequence: 0,
        claim_number: 1,
        claim_text: "1. A widget comprising: a frame; and a fastener coupled to the frame.",
        claim_dependent: null,
        exemplary: 1,
      },
      {
        patent_id: "10000000",
        claim_id: "10000000-2",
        claim_sequence: 1,
        claim_number: 2,
        claim_text: "2. The widget of claim 1, wherein the fastener is a bolt.",
        claim_dependent: "1",
        exemplary: 0,
      },
    ],
  };
}

function patentFixture() {
  return {
    error: false,
    count: 1,
    total_hits: 1,
    g_patent: [
      { patent_id: "10000000", patent_title: "Widget with Improved Fastener", patent_date: "2018-06-19" },
    ],
  };
}

function stubFetchWithFixtures({ claims = claimFixture(), patent = patentFixture(), claimStatus = 200, patentStatus = 200 } = {}) {
  globalThis.fetch = async (url) => {
    if (String(url).includes("/g_claim/")) {
      if (claimStatus !== 200) return { ok: false, status: claimStatus, json: async () => ({}) };
      return { ok: true, json: async () => claims };
    }
    if (String(url).includes("/g_patent/")) {
      if (patentStatus !== 200) return { ok: false, status: patentStatus, json: async () => ({}) };
      return { ok: true, json: async () => patent };
    }
    throw new Error(`unexpected url in test: ${url}`);
  };
}

describe("law.patent-claims (USPTO PatentsView g_claim + g_patent)", () => {
  it("rejects a missing patentId/query", async () => {
    const r = await call("patent-claims", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /patentId or query/);
  });

  it("rejects a patentId/query that normalizes to empty (no digits)", async () => {
    const r = await call("patent-claims", ctxA, { query: "not-a-number" });
    assert.equal(r.ok, false);
    assert.match(r.error, /patentId or query/);
  });

  it("fails fast and honest when PATENTSVIEW_API_KEY is unset — never dispatches a doomed keyless request", async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; throw new Error("should not be called"); };
    const r = await call("patent-claims", ctxA, { patentId: "10000000" });
    assert.equal(r.ok, false);
    assert.match(r.error, /PATENTSVIEW_API_KEY/);
    assert.equal(fetchCalled, false, "must not hit the network without an API key");
  });

  it("normalizes 'query' patent-number formatting (commas, letters, spaces) to digits-only patentId", async () => {
    process.env.PATENTSVIEW_API_KEY = "test-key";
    let capturedClaimUrl = "";
    globalThis.fetch = async (url) => {
      if (String(url).includes("/g_claim/")) capturedClaimUrl = String(url);
      if (String(url).includes("/g_claim/")) return { ok: true, json: async () => ({ g_claim: [] }) };
      return { ok: true, json: async () => ({ g_patent: [] }) };
    };
    const r = await call("patent-claims", ctxA, { query: "US 10,000,000 B2" });
    assert.equal(r.ok, true);
    assert.equal(r.result.patentId, "10000000");
    assert.match(capturedClaimUrl, /patent_id.*10000000/);
  });

  it("sends X-Api-Key header on both g_claim and g_patent requests", async () => {
    process.env.PATENTSVIEW_API_KEY = "secret-key-123";
    const capturedHeaders = [];
    globalThis.fetch = async (url, opts) => {
      capturedHeaders.push(opts?.headers?.["X-Api-Key"]);
      if (String(url).includes("/g_claim/")) return { ok: true, json: async () => claimFixture() };
      return { ok: true, json: async () => patentFixture() };
    };
    const r = await call("patent-claims", ctxA, { patentId: "10000000" });
    assert.equal(r.ok, true);
    assert.equal(capturedHeaders.length, 2);
    assert.ok(capturedHeaders.every((h) => h === "secret-key-123"));
  });

  it("maps a real fixture into the clean { patentId, title, claims[], date } shape, sorted by sequence", async () => {
    process.env.PATENTSVIEW_API_KEY = "test-key";
    stubFetchWithFixtures();
    const r = await call("patent-claims", ctxA, { patentId: "10000000", limit: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.patentId, "10000000");
    assert.equal(r.result.title, "Widget with Improved Fastener");
    assert.equal(r.result.date, "2018-06-19");
    assert.equal(r.result.count, 2);
    assert.equal(r.result.claims.length, 2);
    assert.equal(r.result.source, "uspto-patentsview");

    const [c1, c2] = r.result.claims;
    assert.equal(c1.sequence, 0);
    assert.equal(c1.number, 1);
    assert.equal(c1.text, "1. A widget comprising: a frame; and a fastener coupled to the frame.");
    assert.equal(c1.dependent, null);
    assert.equal(c1.exemplary, true);

    assert.equal(c2.sequence, 1);
    assert.equal(c2.number, 2);
    assert.equal(c2.dependent, "1");
    assert.equal(c2.exemplary, false);
  });

  it("returns an honest empty result on zero claims — never a fabricated placeholder claim", async () => {
    process.env.PATENTSVIEW_API_KEY = "test-key";
    stubFetchWithFixtures({ claims: { error: false, count: 0, total_hits: 0, g_claim: [] } });
    const r = await call("patent-claims", ctxA, { patentId: "99999999" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.claims, []);
    assert.equal(r.result.count, 0);
  });

  it("honest failure on network error fetching claims — never fabricates claim text", async () => {
    process.env.PATENTSVIEW_API_KEY = "test-key";
    globalThis.fetch = async (url) => {
      if (String(url).includes("/g_claim/")) throw new Error("getaddrinfo ENOTFOUND");
      return { ok: true, json: async () => patentFixture() };
    };
    const r = await call("patent-claims", ctxA, { patentId: "10000000" });
    assert.equal(r.ok, false);
    assert.match(r.error, /patentsview unreachable/);
  });

  it("honest, distinct failure when PatentsView rejects the API key (401/403)", async () => {
    process.env.PATENTSVIEW_API_KEY = "bad-key";
    stubFetchWithFixtures({ claimStatus: 401 });
    const r = await call("patent-claims", ctxA, { patentId: "10000000" });
    assert.equal(r.ok, false);
    assert.match(r.error, /auth rejected/);
    assert.match(r.error, /PATENTSVIEW_API_KEY/);
  });

  it("degrades honestly when only the title (g_patent) lookup fails — claims still return, title/date null, titleLookupFailed flagged", async () => {
    process.env.PATENTSVIEW_API_KEY = "test-key";
    globalThis.fetch = async (url) => {
      if (String(url).includes("/g_claim/")) return { ok: true, json: async () => claimFixture() };
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const r = await call("patent-claims", ctxA, { patentId: "10000000" });
    assert.equal(r.ok, true);
    assert.equal(r.result.title, null);
    assert.equal(r.result.date, null);
    assert.equal(r.result.titleLookupFailed, true);
    assert.equal(r.result.claims.length, 2, "claims are the load-bearing part and must still be returned");
  });

  it("never fabricates or infers legal status — always the honest not_available disclosure", async () => {
    process.env.PATENTSVIEW_API_KEY = "test-key";
    stubFetchWithFixtures();
    const r = await call("patent-claims", ctxA, { patentId: "10000000" });
    assert.equal(r.ok, true);
    assert.equal(r.result.legalStatus, "not_available");
    assert.match(r.result.disclosure, /not available/i);
    assert.match(r.result.disclosure, /never inferred/i);
    // Never a computed status value like "active"/"expired"/"lapsed" anywhere on the result.
    assert.equal("status" in r.result, false);
    assert.equal("active" in r.result, false);
  });

  it("clamps limit to [1, 200] and defaults to 50", async () => {
    process.env.PATENTSVIEW_API_KEY = "test-key";
    let capturedClaimUrl = "";
    globalThis.fetch = async (url) => {
      if (String(url).includes("/g_claim/")) { capturedClaimUrl = String(url); return { ok: true, json: async () => ({ g_claim: [] }) }; }
      return { ok: true, json: async () => ({ g_patent: [] }) };
    };
    await call("patent-claims", ctxA, { patentId: "1", limit: 9999 });
    assert.match(capturedClaimUrl, /per_page.*200/);

    await call("patent-claims", ctxA, { patentId: "2", limit: -5 });
    assert.match(capturedClaimUrl, /per_page.*1(?!\d)/);

    await call("patent-claims", ctxA, { patentId: "3" });
    assert.match(capturedClaimUrl, /per_page.*50/);
  });
});
