// FIX-reasoning-008 — arXiv stopwords must not zero out a search.
//
// The Reasoning library's default filter is "chain of thought".
// buildArxivRequest AND-joins one clause per term, and arXiv does not
// index "of" at all (verified live 2026-11-13: all:of → totalResults
// 0; all:chain AND all:thought → 6,826), so the default query
// returned an empty feed while "reasoning llm" returned thousands.
// Stopwords are now dropped from the clauses (the reported query
// string keeps the user's words verbatim).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildArxivRequest } from "../domains/research-live.js";

describe("live_arxiv stopwords (FIX-reasoning-008)", () => {
  it("'chain of thought' builds chain AND thought, with no all:of clause", () => {
    const r = buildArxivRequest("cs.AI", { query: "chain of thought", anyCategory: true });
    assert.equal(r.ok, true);
    assert.match(r.url, /search_query=all:chain\+AND\+all:thought/);
    assert.doesNotMatch(r.url, /all:of/);
    assert.equal(r.query, "chain of thought");
  });

  it("other function words are dropped too ('state of the art')", () => {
    const r = buildArxivRequest("cs.AI", { query: "state of the art", anyCategory: true });
    assert.match(r.url, /search_query=all:state\+AND\+all:art/);
  });

  it("a stopword-only query keeps its terms instead of searching for nothing", () => {
    const r = buildArxivRequest("cs.AI", { query: "of the", anyCategory: true });
    assert.equal(r.ok, true);
    assert.match(r.url, /all:of\+AND\+all:the/);
  });

  it("content queries are unchanged", () => {
    const r = buildArxivRequest("cs.AI", { query: "large language models", anyCategory: true });
    assert.match(r.url, /search_query=all:large\+AND\+all:language\+AND\+all:models/);
  });
});
