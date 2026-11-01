/**
 * live_arxiv optional input: category override, field, anyCategory.
 * fetch is stubbed; nothing touches the network.
 *
 * Run: node --test --test-concurrency=1 server/tests/research-live-arxiv-input.test.js
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerResearchLiveMacros, { buildArxivRequest } from "../domains/research-live.js";

const FEED = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <title>T</title><summary>S</summary>
    <published>2024-01-01T00:00:00Z</published><updated>2024-01-01T00:00:00Z</updated>
    <author><name>A</name></author>
    <category term="cs.LO" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;

function handlers() {
  const map = new Map();
  registerResearchLiveMacros((domain, name, fn) => map.set(`${domain}.${name}`, fn));
  return map;
}

describe("live_arxiv input handling", () => {
  const realFetch = globalThis.fetch;
  let urls;
  let h;
  beforeEach(() => {
    urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return new Response(FEED, { status: 200 });
    };
    h = handlers().get("ai.live_arxiv");
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const q = (u) => new URL(u).searchParams.get("search_query");

  it("keeps the domain default when no new input is given", async () => {
    const r = await h({}, { query: "foo bar" });
    assert.equal(r.ok, true);
    // Research S8 / F9: one field clause PER TERM, AND-joined. A single multi-word value
    // (`all:foo bar`) is read by arXiv as an OR of the words, i.e. a feed, not a search.
    assert.equal(q(urls[0]), "cat:cs.AI AND all:foo AND all:bar");
    assert.ok(urls[0].startsWith("http://export.arxiv.org/api/query?search_query=cat:cs.AI+AND+all:foo+AND+all:bar&"));
    assert.ok(urls[0].includes("sortBy=relevance"), "a query ranks by relevance");
    assert.equal(r.category, "cs.AI");
  });

  it("category overrides the domain default (no query)", async () => {
    const r = await h({}, { category: "q-bio.NC" });
    assert.equal(q(urls[0]), "cat:q-bio.NC");
    assert.equal(r.category, "q-bio.NC");
    assert.equal(r.query, null);
  });

  it("field abs / ti choose the matched field", async () => {
    await h({}, { category: "cs.AI", query: "metacognition", field: "abs" });
    await h({}, { category: "cs.AI", query: "attention", field: "ti" });
    assert.equal(q(urls[0]), "cat:cs.AI AND abs:metacognition");
    assert.equal(q(urls[1]), "cat:cs.AI AND ti:attention");
  });

  it("field cat-only ignores the query", async () => {
    const r = await h({}, { category: "cs.LO", query: "ignored", field: "cat-only" });
    assert.equal(q(urls[0]), "cat:cs.LO");
    assert.equal(r.query, null);
  });

  it("anyCategory drops the cat: filter and encodes the query", async () => {
    const r = await h({}, { anyCategory: true, query: "a&b=c d", limit: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.category, null);
    // per-term clauses, each term still percent-encoded (the & and = stay data, not URL syntax)
    assert.ok(urls[0].includes("search_query=all:a%26b%3Dc+AND+all:d&"));
    assert.ok(urls[0].includes("max_results=5"));
    assert.ok(!urls[0].includes("cat:"));
  });

  it("returns per-paper category from the feed", async () => {
    const r = await h({}, { category: "cs.LO" });
    assert.equal(r.papers[0].category, "cs.LO");
    assert.equal(r.papers[0].arxivId, "2401.00001v1");
  });

  it("only ever calls the fixed arXiv host", async () => {
    await h({}, { category: "cs.LO", query: "http://evil.example/x" });
    assert.equal(new URL(urls[0]).host, "export.arxiv.org");
  });

  it("rejects bad input without fetching", async () => {
    const bad = [
      { category: "CS.AI" },
      { category: "cs.AI; drop" },
      { category: "a".repeat(33) },
      { category: 5 },
      { field: "author" },
      { anyCategory: "yes" },
      { anyCategory: true },
      { anyCategory: true, query: "   " },
      { anyCategory: true, query: "x", field: "cat-only" },
    ];
    for (const input of bad) {
      const r = await h({}, input);
      assert.equal(r.ok, false, JSON.stringify(input));
      assert.equal(r.error, "invalid_input", JSON.stringify(input));
      assert.ok(typeof r.reason === "string" && r.reason.length > 0);
    }
    assert.equal(urls.length, 0);
  });

  it("reports arxiv_unreachable when upstream fails", async () => {
    globalThis.fetch = async () => new Response("no", { status: 503 });
    const r = await h({}, { category: "cs.AI" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "arxiv_unreachable");
  });

  it("buildArxivRequest accepts the boundary 32-char category", () => {
    assert.equal(buildArxivRequest("cs.AI", { category: "a".repeat(32) }).ok, true);
  });
});
