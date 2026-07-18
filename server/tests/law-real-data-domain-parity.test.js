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

  // Combined multi-field boolean query builder (closes
  // docs/lens-specs/law-capability-map.md's "Combined multi-field boolean
  // query builder" gap — was previously one `field` at a time, no combinator).
  describe("multi-field boolean query builder (params.filters)", () => {
    it("single-field query shape is BYTE-IDENTICAL to pre-change behavior (no filters passed)", async () => {
      let capturedUrl = "";
      globalThis.fetch = async (url) => {
        capturedUrl = url;
        return { ok: true, json: async () => ({ count: 0, patents: [] }) };
      };
      await call("uspto-patent-search", ctxA, { query: "quantum computing", field: "title", limit: 25 });
      const decodedQ = decodeURIComponent(capturedUrl.match(/[?&]q=([^&]+)/)[1]);
      assert.equal(decodedQ, JSON.stringify({ _text_phrase: { patent_title: "quantum computing" } }));
    });

    it("two filters combined with AND (default combinator) build a PatentsView _and clause", async () => {
      let capturedUrl = "";
      globalThis.fetch = async (url) => {
        capturedUrl = url;
        return { ok: true, json: async () => ({ count: 0, patents: [] }) };
      };
      const r = await call("uspto-patent-search", ctxA, {
        filters: [
          { field: "title", value: "quantum computing" },
          { field: "assignee", value: "IBM" },
        ],
      });
      assert.equal(r.ok, true);
      const decodedQ = decodeURIComponent(capturedUrl.match(/[?&]q=([^&]+)/)[1]);
      assert.equal(
        decodedQ,
        JSON.stringify({
          _and: [
            { _text_phrase: { patent_title: "quantum computing" } },
            { _text_phrase: { assignee_organization: "IBM" } },
          ],
        })
      );
      assert.equal(r.result.field, "combined");
      assert.equal(r.result.combinator, "and");
      assert.deepEqual(r.result.filters, [
        { field: "title", value: "quantum computing" },
        { field: "assignee", value: "IBM" },
      ]);
      assert.equal(r.result.query, "quantum computing AND IBM");
    });

    it("filters combined with OR build a PatentsView _or clause", async () => {
      let capturedUrl = "";
      globalThis.fetch = async (url) => {
        capturedUrl = url;
        return { ok: true, json: async () => ({ count: 0, patents: [] }) };
      };
      const r = await call("uspto-patent-search", ctxA, {
        combinator: "or",
        filters: [
          { field: "inventor", value: "Doe" },
          { field: "assignee", value: "Acme Corp" },
        ],
      });
      assert.equal(r.ok, true);
      const decodedQ = decodeURIComponent(capturedUrl.match(/[?&]q=([^&]+)/)[1]);
      assert.equal(
        decodedQ,
        JSON.stringify({
          _or: [
            { _text_phrase: { inventor_name_last: "Doe" } },
            { _text_phrase: { assignee_organization: "Acme Corp" } },
          ],
        })
      );
      assert.equal(r.result.combinator, "or");
      assert.equal(r.result.query, "Doe OR Acme Corp");
    });

    it("drops invalid filter rows (bad field / empty value) and keeps the valid ones", async () => {
      let capturedUrl = "";
      globalThis.fetch = async (url) => {
        capturedUrl = url;
        return { ok: true, json: async () => ({ count: 0, patents: [] }) };
      };
      const r = await call("uspto-patent-search", ctxA, {
        filters: [
          { field: "bogus-field", value: "should be dropped" },
          { field: "title", value: "   " }, // whitespace-only, dropped
          { field: "abstract", value: "neural interface" },
        ],
      });
      assert.equal(r.ok, true);
      assert.deepEqual(r.result.filters, [{ field: "abstract", value: "neural interface" }]);
      const decodedQ = decodeURIComponent(capturedUrl.match(/[?&]q=([^&]+)/)[1]);
      assert.equal(decodedQ, JSON.stringify({ _and: [{ _text_phrase: { patent_abstract: "neural interface" } }] }));
    });

    it("honest empty-filters fallback: an all-invalid/empty filters array behaves exactly as if filters were omitted", async () => {
      // No usable filters + no top-level query at all → same "query required" honest failure as before.
      const rejected = await call("uspto-patent-search", ctxA, { filters: [] });
      assert.equal(rejected.ok, false);
      assert.match(rejected.error, /query required/);

      const rejected2 = await call("uspto-patent-search", ctxA, {
        filters: [{ field: "not-a-real-field", value: "x" }, { field: "title", value: "" }],
      });
      assert.equal(rejected2.ok, false);
      assert.match(rejected2.error, /query required/);

      // No usable filters, but a top-level query/field IS present → falls back
      // to the ordinary single-field path, byte-identical shape.
      let capturedUrl = "";
      globalThis.fetch = async (url) => {
        capturedUrl = url;
        return { ok: true, json: async () => ({ count: 0, patents: [] }) };
      };
      const r = await call("uspto-patent-search", ctxA, { filters: [], query: "fallback term", field: "inventor" });
      assert.equal(r.ok, true);
      assert.equal(r.result.field, "inventor");
      assert.equal(r.result.filters, undefined);
      assert.equal(r.result.combinator, undefined);
      const decodedQ = decodeURIComponent(capturedUrl.match(/[?&]q=([^&]+)/)[1]);
      assert.equal(decodedQ, JSON.stringify({ _text_phrase: { inventor_name_last: "fallback term" } }));
    });
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

  // Semantic / natural-language search (closes docs/lens-specs/law-capability-map.md's
  // "Semantic / natural-language search" gap). CourtListener v4's real GET-mode
  // param is `semantic=true` — verified against freelawproject/courtlistener's
  // open-source Django code (cl/search/forms.py's SearchForm.semantic field,
  // cl/search/api_serializers.py's SemanticSearchScoreSerializer) since
  // courtlistener.com/free.law itself is network-blocked in this environment.
  describe("semantic mode", () => {
    it("keyword-mode request is byte-identical to the pre-semantic behavior (no `semantic` key at all)", async () => {
      let capturedUrl = "";
      globalThis.fetch = async (url) => {
        capturedUrl = url;
        return { ok: true, json: async () => ({ count: 0, results: [] }) };
      };
      const r = await call("courtlistener-search", ctxA, { query: "qualified immunity" });
      assert.equal(r.ok, true);
      // Exact byte-for-byte query string — same param set/order as before this change.
      assert.equal(capturedUrl, "https://www.courtlistener.com/api/rest/v4/search/?q=qualified+immunity&type=o&page_size=10");
      assert.equal(r.result.semantic, false);
    });

    it("semantic mode (params.semantic: true) adds the real `semantic=true` param", async () => {
      let capturedUrl = "";
      globalThis.fetch = async (url) => {
        capturedUrl = url;
        return { ok: true, json: async () => ({ count: 0, results: [] }) };
      };
      const r = await call("courtlistener-search", ctxA, { query: "excessive force by police", semantic: true });
      assert.equal(r.ok, true);
      assert.match(capturedUrl, /[?&]semantic=true(&|$)/);
      assert.match(capturedUrl, /type=o/);  // semantic search is opinion-only on CourtListener's side too
      assert.equal(r.result.semantic, true);
    });

    it("semantic mode also accepts the string 'true' (macro params travel over JSON/HTTP)", async () => {
      globalThis.fetch = async (url) => {
        assert.match(url, /semantic=true/);
        return { ok: true, json: async () => ({ results: [] }) };
      };
      const r = await call("courtlistener-search", ctxA, { query: "x", semantic: "true" });
      assert.equal(r.result.semantic, true);
    });

    it("parses meta.score.{bm25,semantic} defensively for both modes", async () => {
      const scoredOpinion = (score) => ({
        id: 1, caseName: "Doe v. Roe", court: "N.D. Cal.", court_id: "cand",
        dateFiled: "2024-01-01", absolute_url: "/opinion/1/doe-v-roe/",
        snippet: "s", citation: ["1 F.4th 1"], status: "Published",
        docketNumber: "1", judge: "J", author: "A",
        meta: { score, timestamp: "2024-01-01T00:00:00Z" },
      });

      // Keyword mode: CourtListener only ever returns a bm25 score.
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({ count: 1, results: [scoredOpinion({ bm25: 4.2 })] }),
      });
      const kw = await call("courtlistener-search", ctxA, { query: "x" });
      assert.equal(kw.result.results[0].bm25Score, 4.2);
      assert.equal(kw.result.results[0].semanticScore, null);

      // Semantic mode: CourtListener adds a semantic score alongside bm25.
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({ count: 1, results: [scoredOpinion({ bm25: 4.2, semantic: 0.87 })] }),
      });
      const sem = await call("courtlistener-search", ctxA, { query: "x", semantic: true });
      assert.equal(sem.result.results[0].bm25Score, 4.2);
      assert.equal(sem.result.results[0].semanticScore, 0.87);

      // Degrade gracefully — no meta at all (older/unscored shape) never throws, never fabricates.
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({ count: 1, results: [{ id: 2, caseName: "No Meta" }] }),
      });
      const noMeta = await call("courtlistener-search", ctxA, { query: "x" });
      assert.equal(noMeta.ok, true);
      assert.equal(noMeta.result.results[0].bm25Score, null);
      assert.equal(noMeta.result.results[0].semanticScore, null);
    });
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
