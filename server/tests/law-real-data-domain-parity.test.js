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

describe("law.recap-docket-search (CourtListener RECAP Archive)", () => {
  it("rejects when neither query nor docketNumber is given", async () => {
    const r = await call("recap-docket-search", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /query or docketNumber/);
  });

  it("hits CourtListener RECAP search (type=r) + shapes docket + document results, disclosing free-vs-PACER honestly", async () => {
    let capturedUrl = "", capturedAuth = "";
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedAuth = opts?.headers?.Authorization || "";
      return {
        ok: true,
        json: async () => ({
          count: 3,
          results: [{
            id: 555111,
            caseName: "United States v. Concord Data",
            court: "Northern District of California",
            court_id: "cand",
            docketNumber: "3:24-cv-01234",
            dateFiled: "2024-02-01",
            dateTerminated: null,
            assignedTo: "Hon. Jane Roe",
            suitNature: "Civil Rights",
            docket_absolute_url: "/docket/555111/united-states-v-concord-data/",
            more_docs: true,
            recap_documents: [
              {
                id: 9001,
                description: "COMPLAINT against Concord Data",
                document_number: 1,
                attachment_number: null,
                is_available: true,
                filepath_local: "/recap/gov.uscourts.cand.555111/gov.uscourts.cand.555111.1.0.pdf",
              },
              {
                id: 9002,
                description: "SEALED MOTION",
                document_number: 2,
                attachment_number: null,
                is_available: false,
                filepath_local: null,
              },
              {
                id: 9003,
                description: "SUMMONS ISSUED",
                document_number: 3,
                attachment_number: null,
                filepath_local: null,
                // is_available omitted entirely — availability genuinely unknown
              },
            ],
          }],
        }),
      };
    };
    const r = await call("recap-docket-search", ctxA, { query: "Concord Data" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /courtlistener\.com\/api\/rest\/v4\/search/);
    assert.match(capturedUrl, /type=r/);
    assert.match(capturedUrl, /q=Concord\+Data/);
    assert.equal(capturedAuth, "");
    assert.equal(r.result.source, "courtlistener-recap");
    assert.equal(r.result.results.length, 1);

    const docket = r.result.results[0];
    assert.equal(docket.docketId, 555111);
    assert.equal(docket.caseName, "United States v. Concord Data");
    assert.equal(docket.docketNumber, "3:24-cv-01234");
    assert.equal(docket.absoluteUrl, "https://www.courtlistener.com/docket/555111/united-states-v-concord-data/");
    assert.equal(docket.moreDocsAvailable, true);
    assert.equal(docket.documentCount, 3);

    // Honest per-document tiering: true / false / unknown (null) — never
    // guessed, never uniformly "free".
    assert.equal(docket.documents[0].freelyAvailable, true);
    assert.equal(docket.documents[0].documentUrl, "https://www.courtlistener.com/recap/gov.uscourts.cand.555111/gov.uscourts.cand.555111.1.0.pdf");
    assert.equal(docket.documents[1].freelyAvailable, false);
    assert.equal(docket.documents[1].documentUrl, null);
    assert.equal(docket.documents[2].freelyAvailable, null);

    assert.match(r.result.disclosure, /PACER purchase/);
  });

  it("supports docketNumber-only lookup + court/date filters", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ results: [] }) };
    };
    await call("recap-docket-search", ctxA, {
      docketNumber: "3:24-cv-01234",
      court: "cand", dateAfter: "2024-01-01", dateBefore: "2024-12-31",
    });
    assert.match(capturedUrl, /type=r/);
    assert.match(capturedUrl, /docketNumber/);
    assert.match(capturedUrl, /court=cand/);
    assert.match(capturedUrl, /filed_after=2024-01-01/);
    assert.match(capturedUrl, /filed_before=2024-12-31/);
  });

  it("returns an honest empty result on zero matches", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ count: 0, results: [] }) });
    const r = await call("recap-docket-search", ctxA, { query: "no such docket anywhere" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.results, []);
    assert.equal(r.result.count, 0);
  });

  it("uses COURTLISTENER_API_TOKEN env when set", async () => {
    process.env.COURTLISTENER_API_TOKEN = "test-token-abc";
    let capturedAuth = "";
    globalThis.fetch = async (_url, opts) => {
      capturedAuth = opts?.headers?.Authorization || "";
      return { ok: true, json: async () => ({ results: [] }) };
    };
    const r = await call("recap-docket-search", ctxA, { query: "x" });
    assert.equal(capturedAuth, "Token test-token-abc");
    assert.equal(r.result.authenticatedWithToken, true);
  });

  it("honest failure on rate limit (429)", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const r = await call("recap-docket-search", ctxA, { query: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /rate limit.*COURTLISTENER_API_TOKEN/);
  });

  it("honest failure on network error (unreachable)", async () => {
    globalThis.fetch = async () => { throw new Error("getaddrinfo ENOTFOUND"); };
    const r = await call("recap-docket-search", ctxA, { query: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /courtlistener unreachable/);
  });
});

describe("law.recap-docket-documents (CourtListener RECAP Archive)", () => {
  it("rejects a missing/invalid docketId", async () => {
    const r = await call("recap-docket-documents", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /docketId/);
  });

  it("pages a docket's full document list via docket_entry__docket filter", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          count: 2,
          results: [
            { id: 1, description: "COMPLAINT", document_number: 1, is_available: true, filepath_local: "/recap/x/1.pdf", page_count: 12 },
            { id: 2, description: "ANSWER", document_number: 2, is_available: false, filepath_local: null, page_count: null },
          ],
        }),
      };
    };
    const r = await call("recap-docket-documents", ctxA, { docketId: 555111 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /recap-documents/);
    assert.match(capturedUrl, /docket_entry__docket=555111/);
    assert.equal(r.result.documents.length, 2);
    assert.equal(r.result.documents[0].freelyAvailable, true);
    assert.equal(r.result.documents[1].freelyAvailable, false);
    assert.equal(r.result.documents[1].documentUrl, null);
  });

  it("returns an honest empty result when a docket has no documents", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ count: 0, results: [] }) });
    const r = await call("recap-docket-documents", ctxA, { docketId: 42 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.documents, []);
  });

  it("honest failure on network error", async () => {
    globalThis.fetch = async () => { throw new Error("network down"); };
    const r = await call("recap-docket-documents", ctxA, { docketId: 42 });
    assert.equal(r.ok, false);
    assert.match(r.error, /courtlistener unreachable/);
  });
});
