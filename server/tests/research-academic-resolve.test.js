import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/research.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

// S1 (F1) — identifier capture: academic-resolve-import resolves a DOI /
// arXiv ID / paper URL server-side and files the reference with its
// source named; unknown identifiers are an honest not_found and file
// nothing. Fetch is stubbed per test; beforeEach disables the network.

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`research.${name}`);
  if (!fn) throw new Error(`research.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  clearExternalFetchCache();
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return typeof body === "string" ? body : JSON.stringify(body); },
  };
}

const CROSSREF_ALPHA_GO = {
  message: {
    DOI: "10.1038/nature16961",
    title: ["Mastering the game of Go with deep neural networks and tree search"],
    author: [
      { given: "David", family: "Silver" },
      { given: "Aja", family: "Huang" },
    ],
    "published-print": { "date-parts": [[2016, 1, 28]] },
    "container-title": ["Nature"],
    publisher: "Springer Science and Business Media LLC",
    type: "journal-article",
    "is-referenced-by-count": 11982,
    URL: "https://doi.org/10.1038/nature16961",
    abstract: "<jats:p>We introduce a new approach to computer Go.</jats:p>",
  },
};

describe("research — academic-resolve-import (S1 identifier capture)", () => {
  it("resolves a DOI via Crossref and files the reference with full metadata + source", async () => {
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      return jsonResponse(200, CROSSREF_ALPHA_GO);
    };
    const r = await call("academic-resolve-import", ctxA, { identifier: "10.1038/nature16961" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(seen[0], /api\.crossref\.org\/works\/10\.1038%2Fnature16961/);
    const ref = r.result.reference;
    assert.equal(ref.title, "Mastering the game of Go with deep neural networks and tree search");
    assert.equal(ref.authors, "David Silver, Aja Huang");
    assert.equal(ref.year, 2016);
    assert.equal(ref.journal, "Nature");
    assert.equal(ref.doi, "10.1038/nature16961");
    assert.equal(ref.citationCount, 11982);
    assert.equal(ref.source, "crossref");
    assert.equal(ref.abstract, "We introduce a new approach to computer Go.");
    const lib = call("reference-list", ctxA);
    assert.equal(lib.result.references.length, 1);
    assert.equal(lib.result.references[0].source, "crossref");
  });

  it("accepts a doi.org URL for the same DOI", async () => {
    globalThis.fetch = async () => jsonResponse(200, {
      message: { ...CROSSREF_ALPHA_GO.message, DOI: "10.1000/xyz123", title: ["Some Paper"] },
    });
    const r = await call("academic-resolve-import", ctxA, { identifier: "https://doi.org/10.1000/xyz123" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.reference.doi, "10.1000/xyz123");
    assert.equal(r.result.reference.source, "crossref");
  });

  it("falls back to OpenAlex when Crossref has no record (404)", async () => {
    const seen = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      seen.push(u);
      if (u.includes("api.crossref.org")) return jsonResponse(404, {});
      return jsonResponse(200, {
        id: "https://openalex.org/W999",
        display_name: "Fallback Paper",
        publication_year: 2021,
        authorships: [{ author: { display_name: "Grace Hopper" } }],
        cited_by_count: 42,
        primary_location: { source: { display_name: "JACM" } },
        open_access: { oa_url: null },
        doi: "https://doi.org/10.5555/fallback.1",
        abstract_inverted_index: null,
      });
    };
    const r = await call("academic-resolve-import", ctxA, { identifier: "10.5555/fallback.1" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(seen.some((u) => u.includes("api.openalex.org/works/doi:")), seen.join(" | "));
    const ref = r.result.reference;
    assert.equal(ref.title, "Fallback Paper");
    assert.equal(ref.authors, "Grace Hopper");
    assert.equal(ref.year, 2021);
    assert.equal(ref.journal, "JACM");
    assert.equal(ref.doi, "10.5555/fallback.1");
    assert.equal(ref.source, "openalex");
  });

  it("unknown DOI → honest not_found and NO record is created", async () => {
    globalThis.fetch = async () => jsonResponse(404, {});
    const r = await call("academic-resolve-import", ctxA, { identifier: "10.9999/does.not.exist" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_found");
    const lib = call("reference-list", ctxA);
    assert.equal(lib.result.references.length, 0);
  });

  it("both APIs unreachable → resolve failure, distinct from not_found, no record", async () => {
    globalThis.fetch = async () => { throw new Error("socket hang up"); };
    const r = await call("academic-resolve-import", ctxA, { identifier: "10.1038/nature16961" });
    assert.equal(r.ok, false);
    assert.match(r.error, /resolve failed/);
    assert.notEqual(r.error, "not_found");
    const lib = call("reference-list", ctxA);
    assert.equal(lib.result.references.length, 0);
  });

  it("resolves an arXiv ID via the arXiv API and files a preprint", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models are based on complex recurrent networks.</summary>
    <published>2017-06-12T17:57:34Z</published>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
  </entry>
</feed>`;
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      return { ok: true, status: 200, async text() { return xml; }, async json() { return {}; } };
    };
    const r = await call("academic-resolve-import", ctxA, { identifier: "1706.03762" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(seen[0], /export\.arxiv\.org\/api\/query\?id_list=1706\.03762/);
    const ref = r.result.reference;
    assert.equal(ref.title, "Attention Is All You Need");
    assert.equal(ref.authors, "Ashish Vaswani, Noam Shazeer");
    assert.equal(ref.year, 2017);
    assert.equal(ref.type, "preprint");
    assert.equal(ref.source, "arxiv");
  });

  it("garbage identifier → honest unsupported_identifier, fetch never called, no record", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls += 1; throw new Error("must not be called"); };
    const r = await call("academic-resolve-import", ctxA, { identifier: "my favourite paper about graphs" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "unsupported_identifier");
    assert.equal(fetchCalls, 0);
    const lib = call("reference-list", ctxA);
    assert.equal(lib.result.references.length, 0);
  });

  it("missing identifier → error, no record", async () => {
    const r = await call("academic-resolve-import", ctxA, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "identifier required");
  });

  it("preview resolves the DOI but files nothing (panel DOI lookup)", async () => {
    globalThis.fetch = async () => jsonResponse(200, CROSSREF_ALPHA_GO);
    const r = await call("academic-resolve-import", ctxA, { identifier: "10.1038/nature16961", preview: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.reference, null);
    assert.equal(r.result.work.title, "Mastering the game of Go with deep neural networks and tree search");
    assert.equal(r.result.source, "crossref");
    const lib = call("reference-list", ctxA);
    assert.equal(lib.result.references.length, 0);
  });

  it("academic-import now stores the work's source on the record", () => {
    const r = call("academic-import", ctxA, {
      work: { title: "Imported via OpenAlex", authors: ["Jane Doe"], year: 2024, source: "openalex", venue: "NeurIPS" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.reference.source, "openalex");
    const r2 = call("academic-import", ctxA, {
      work: { title: "Imported via arXiv", authors: ["John Doe"], year: 2023, source: "arxiv", venue: "arXiv" },
    });
    assert.equal(r2.result.reference.source, "arxiv");
    assert.equal(r2.result.reference.type, "preprint");
  });
});
