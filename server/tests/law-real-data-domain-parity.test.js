// Contract tests for the new law lens real-API macros: USPTO
// PatentsView patent search + CourtListener case opinion search.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLawActions from "../domains/law.js";

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
  delete process.env.COURTLISTENER_API_TOKEN;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("law.uspto-patent-search (USPTO PatentsView)", () => {
  it("rejects empty query", async () => {
    assert.equal((await call("uspto-patent-search", ctxA, {})).ok, false);
  });

  it("hits PatentsView + parses + flattens inventors/assignees", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          count: 1247,
          patents: [{
            patent_id: "11000000",
            patent_title: "Quantum Random Number Generator",
            patent_abstract: "A system for generating quantum-derived random numbers...",
            patent_date: "2021-05-04",
            inventors: [
              { inventor_name_first: "Jane", inventor_name_last: "Doe" },
              { inventor_name_first: "Bob", inventor_name_last: "Smith" },
            ],
            assignees: [{ assignee_organization: "Acme Quantum Corp" }],
          }],
        }),
      };
    };
    const r = await call("uspto-patent-search", ctxA, { query: "quantum", field: "title" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /search\.patentsview\.org\/api\/v1\/patent/);
    // q should be URL-encoded JSON
    assert.match(capturedUrl, /patent_title/);
    assert.equal(r.result.patents[0].patentId, "11000000");
    assert.deepEqual(r.result.patents[0].inventors, ["Jane Doe", "Bob Smith"]);
    assert.deepEqual(r.result.patents[0].assignees, ["Acme Quantum Corp"]);
    assert.equal(r.result.totalHits, 1247);
    assert.equal(r.result.source, "uspto-patentsview");
  });

  it("supports inventor / assignee / abstract field switching", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ patents: [] }) };
    };
    await call("uspto-patent-search", ctxA, { query: "Musk", field: "inventor" });
    assert.match(capturedUrl, /inventor_name_last/);
    await call("uspto-patent-search", ctxA, { query: "Apple", field: "assignee" });
    assert.match(capturedUrl, /assignee_organization/);
  });
});

describe("law.courtlistener-search (CourtListener)", () => {
  it("rejects empty query", async () => {
    assert.equal((await call("courtlistener-search", ctxA, {})).ok, false);
  });

  it("hits CourtListener search (no token by default) + shapes results", async () => {
    let capturedUrl = "", capturedAuth = "";
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedAuth = opts?.headers?.Authorization || "";
      return {
        ok: true,
        json: async () => ({
          count: 42,
          results: [{
            id: 987654,
            caseName: "Concord v. Reality",
            court: "Supreme Court of the United States",
            court_id: "scotus",
            dateFiled: "2024-06-15",
            absolute_url: "/opinion/987654/concord-v-reality/",
            snippet: "The petitioner argues that the synthesized data violated...",
            citation: ["602 U.S. ___"],
            status: "Published",
            docketNumber: "23-1234",
            judge: "Roberts",
            author: "Roberts, C. J.",
          }],
        }),
      };
    };
    const r = await call("courtlistener-search", ctxA, { query: "real data" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /courtlistener\.com\/api\/rest\/v4\/search/);
    // URLSearchParams uses + for spaces (not %20)
    assert.match(capturedUrl, /q=real\+data/);
    assert.match(capturedUrl, /type=o/);
    assert.equal(capturedAuth, "");  // no token
    assert.equal(r.result.results[0].caseName, "Concord v. Reality");
    assert.equal(r.result.results[0].absoluteUrl, "https://www.courtlistener.com/opinion/987654/concord-v-reality/");
    assert.equal(r.result.authenticatedWithToken, false);
    assert.equal(r.result.source, "courtlistener");
  });

  it("uses COURTLISTENER_API_TOKEN env when set", async () => {
    process.env.COURTLISTENER_API_TOKEN = "test-token-abc";
    let capturedAuth = "";
    globalThis.fetch = async (_url, opts) => {
      capturedAuth = opts?.headers?.Authorization || "";
      return { ok: true, json: async () => ({ results: [] }) };
    };
    const r = await call("courtlistener-search", ctxA, { query: "x" });
    assert.equal(capturedAuth, "Token test-token-abc");
    assert.equal(r.result.authenticatedWithToken, true);
  });

  it("supports court + date filters", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ results: [] }) };
    };
    await call("courtlistener-search", ctxA, {
      query: "first amendment",
      court: "scotus", dateAfter: "2020-01-01", dateBefore: "2024-12-31",
    });
    assert.match(capturedUrl, /court=scotus/);
    assert.match(capturedUrl, /filed_after=2020-01-01/);
    assert.match(capturedUrl, /filed_before=2024-12-31/);
  });

  it("surfaces 429 with helpful token pointer", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const r = await call("courtlistener-search", ctxA, { query: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /rate limit.*COURTLISTENER_API_TOKEN/);
  });
});
