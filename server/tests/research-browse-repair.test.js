import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/research.js";
import registerResearchLiveMacros, { buildArxivRequest } from "../domains/research-live.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

// S8 (F9) — browse repair. arXiv: the macro built the query as ONE
// encoded field value (`all:large%20language%20models`); arXiv's parser
// ORs an unquoted multi-word value (live-verified: totalResults
// 1,562,512, feed title "all:large OR all:language OR all:models"), so
// every multi-word search showed the newest papers in the corpus — a
// feed wearing a search box. The fix builds one clause per term,
// AND-joined, and ranks queried searches by relevance. CrossRef: the
// shared live_crossref (scholarly-apis.js, untouched) presents
// Crossref's generic-query order uncritically, which for a title
// search buries the paper under derivative works and near-identical
// clone deposits; the research domain's crossref-search macro searches
// a deep query.title pool, collapses duplicate deposits into their
// most complete record, and ranks canonical (exact-title) records
// first, with the collapse counted on the record.

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function callResearch(name, ctx, params = {}) {
  const fn = ACTIONS.get(`research.${name}`);
  if (!fn) throw new Error(`research.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
function callLiveArxiv(ctx, input = {}) {
  const fn = ACTIONS.get("ai.live_arxiv");
  if (!fn) throw new Error("ai.live_arxiv not registered");
  return fn(ctx, input);
}

before(() => { registerActions(register); registerResearchLiveMacros(register); });
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

const ATOM_ONE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
<opensearch:totalResults>1</opensearch:totalResults>
<entry>
<id>http://arxiv.org/abs/1706.03762v5</id>
<title>Attention Is All You Need</title>
<summary>The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.</summary>
<published>2017-06-12T17:57:34Z</published>
<updated>2023-08-02T00:00:00Z</updated>
<author><name>Ashish Vaswani</name></author>
<author><name>Noam Shazeer</name></author>
<category term="cs.CL"/>
</entry>
</feed>`;

const ATOM_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
<opensearch:totalResults>0</opensearch:totalResults>
</feed>`;

describe("research-live — buildArxivRequest (S8 arXiv query construction)", () => {
  it("builds one AND-joined clause per term for a multi-word query", () => {
    const r = buildArxivRequest("cs.AI", { query: "large language models", anyCategory: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.url, /search_query=all:large\+AND\+all:language\+AND\+all:models/);
    assert.doesNotMatch(r.url, /all:large%20language/);
    assert.equal(r.query, "large language models");
  });

  it("ranks a queried search by relevance, not submission date", () => {
    const r = buildArxivRequest("cs.AI", { query: "attention", anyCategory: true });
    assert.match(r.url, /sortBy=relevance/);
  });

  it("combines the category clause with AND-joined terms", () => {
    const r = buildArxivRequest("cs.LG", { query: "graph neural networks" });
    assert.match(r.url, /search_query=cat:cs\.LG\+AND\+all:graph\+AND\+all:neural\+AND\+all:networks/);
  });

  it("leaves the bare category feed byte-identical: cat clause, newest first", () => {
    const r = buildArxivRequest("quant-ph", {});
    assert.equal(r.ok, true);
    assert.match(r.url, /search_query=cat:quant-ph&start=0&max_results=15&sortBy=submittedDate/);
    assert.equal(r.query, null);
    assert.equal(r.category, "quant-ph");
  });

  it("keeps single-word queries a single clause", () => {
    const r = buildArxivRequest("cs.AI", { query: "zyzzyva", anyCategory: true });
    assert.match(r.url, /search_query=all:zyzzyva&/);
  });

  it("honours the field parameter per term and strips arXiv syntax characters", () => {
    const r = buildArxivRequest("cs.AI", { query: '"attention" (mechanisms)', field: "ti", anyCategory: true });
    assert.match(r.url, /search_query=ti:attention\+AND\+ti:mechanisms/);
    assert.doesNotMatch(r.url, /%22|%28|%29/);
  });

  it("still requires a usable query when anyCategory is set", () => {
    const r = buildArxivRequest("cs.AI", { query: '""', anyCategory: true });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });
});

describe("research-live — live_arxiv macro (S8)", () => {
  it("sends the AND construction to arXiv and parses the results", async () => {
    const seen = [];
    globalThis.fetch = async (url) => { seen.push(String(url)); return jsonResponse(200, ATOM_ONE); };
    const r = await callLiveArxiv(ctxA, { query: "large language models", anyCategory: true, limit: 5 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(seen[0], /search_query=all:large\+AND\+all:language\+AND\+all:models/);
    assert.match(seen[0], /max_results=5/);
    assert.equal(r.papers.length, 1);
    assert.equal(r.papers[0].title, "Attention Is All You Need");
    assert.equal(r.query, "large language models");
  });

  it("surfaces an empty arXiv page honestly (nonsense query → zero papers, still ok)", async () => {
    globalThis.fetch = async () => jsonResponse(200, ATOM_EMPTY);
    const r = await callLiveArxiv(ctxA, { query: "zyzzyva qqqnonexistent", anyCategory: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.papers, []);
    assert.equal(r.total, 0);
  });
});

describe("research — academic-search arXiv provider (S8, same construction)", () => {
  it("builds term-AND clauses instead of one encoded blob", async () => {
    const seen = [];
    globalThis.fetch = async (url) => { seen.push(String(url)); return jsonResponse(200, ATOM_ONE); };
    const r = await callResearch("academic-search", ctxA, { provider: "arxiv", query: "graph neural networks" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(seen[0], /search_query=all:graph\+AND\+all:neural\+AND\+all:networks/);
    assert.doesNotMatch(seen[0], /all:graph%20neural/);
    assert.equal(r.result.results.length, 1);
    assert.equal(r.result.results[0].title, "Attention Is All You Need");
  });
});

// ── CrossRef canonical preference ────────────────────────────────────

function crItem({ doi, title, authors = [], year, container, publisher, type = "journal-article", cites, subjects = [], score }) {
  const item = {
    DOI: doi,
    title: [title],
    author: authors.map((n) => {
      const parts = n.split(" ");
      return { given: parts.slice(0, -1).join(" "), family: parts[parts.length - 1] };
    }),
    type,
    subject: subjects,
    URL: `https://doi.org/${doi}`,
  };
  if (year) item["published-print"] = { "date-parts": [[year]] };
  if (container) item["container-title"] = [container];
  if (publisher) item.publisher = publisher;
  if (cites != null) item["is-referenced-by-count"] = cites;
  if (score != null) item.score = score;
  return item;
}

const VASWANI_ET_AL = ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit",
  "Llion Jones", "Aidan Gomez", "Lukasz Kaiser", "Illia Polosukhin"];

// Crossref's order for "attention is all you need", as live-verified:
// derivative works and the 10.65215 clone swarm ahead of everything.
const ATTENTION_POOL = {
  message: {
    "total-results": 938242,
    items: [
      crItem({ doi: "10.1007/978-3-031-84300-6_13", title: "Is Attention All You Need?",
        authors: ["Patrick Mineault"], year: 2025, container: "Lecture Notes in Computer Science",
        publisher: "Springer Nature Switzerland", cites: 55, score: 40 }),
      crItem({ doi: "10.65215/mdcm8z23", title: "Attention Is All You Need",
        authors: VASWANI_ET_AL, year: 2017, publisher: "Shenzhen Medical Academy of Research and Translation",
        type: "posted-content", cites: 3, score: 39 }),
      crItem({ doi: "10.65215/ctdc8e75", title: "Attention Is All You Need",
        authors: VASWANI_ET_AL, year: 2017, publisher: "Shenzhen Medical Academy of Research and Translation",
        type: "posted-content", cites: 67, score: 38 }),
      // Same DOI as the previous clone, different case, sparser record.
      crItem({ doi: "10.65215/CTDC8E75", title: "Attention Is All You Need",
        authors: VASWANI_ET_AL, publisher: "Shenzhen Medical Academy of Research and Translation",
        type: "posted-content", score: 37 }),
      crItem({ doi: "10.1201/9781003561460-19", title: "Attention Is All You Need",
        authors: ["J. Mark Bishop"], year: 2024, container: "The Handbook of Artificial Intelligence",
        publisher: "Routledge", cites: 6, score: 36 }),
      crItem({ doi: "10.2139/ssrn.4993784", title: "Attention Is All You Need: An Analysis Of The Valuation Of Artificial Intelligence",
        authors: ["Mfon Akpan"], year: 2024, publisher: "Elsevier BV", type: "posted-content", cites: 0, score: 35 }),
      // The canonical-shaped record: exact title, full metadata — and
      // the LOWEST Crossref score in the pool, to prove the ranking is
      // ours, not Crossref's order re-labelled.
      crItem({ doi: "10.1234/nips.2017.7181", title: "Attention Is All You Need",
        authors: VASWANI_ET_AL, year: 2017, container: "Advances in Neural Information Processing Systems 30",
        publisher: "Curran Associates", cites: 5000, score: 10 }),
    ],
  },
};

const ALPHAGO_POOL = {
  message: {
    "total-results": 1240,
    items: [
      crItem({ doi: "10.1038/nature24270", title: "Mastering the game of Go without human knowledge",
        authors: ["David Silver"], year: 2017, container: "Nature",
        publisher: "Springer Science and Business Media LLC", cites: 7113, score: 42 }),
      // A sparse duplicate deposit of the canonical work itself.
      crItem({ doi: "10.9999/sparse.deposit", title: "Mastering the game of Go with deep neural networks and tree search",
        authors: ["David Silver"], score: 41 }),
      crItem({ doi: "10.1038/nature16961", title: "Mastering the game of Go with deep neural networks and tree search",
        authors: ["David Silver", "Aja Huang"], year: 2016, container: "Nature",
        publisher: "Springer Science and Business Media LLC", cites: 11982, score: 12 }),
    ],
  },
};

describe("research — crossref-search (S8 canonical preference)", () => {
  it("queries Crossref's title-weighted parameter over a deep pool", async () => {
    const seen = [];
    globalThis.fetch = async (url) => { seen.push(String(url)); return jsonResponse(200, ATTENTION_POOL); };
    const r = await callResearch("crossref-search", ctxA, { query: "attention is all you need" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(seen[0], /api\.crossref\.org\/works\?query\.title=attention%20is%20all%20you%20need/);
    assert.match(seen[0], /rows=50/);
    assert.doesNotMatch(seen[0], /[?&]query=/);
  });

  it("ranks the canonical record first for its own title, ahead of Crossref's order", async () => {
    globalThis.fetch = async () => jsonResponse(200, ATTENTION_POOL);
    const r = await callResearch("crossref-search", ctxA, { query: "attention is all you need" });
    const works = r.result.works;
    assert.equal(works[0].doi, "10.1234/nips.2017.7181");
    assert.equal(works[0].exactTitleMatch, true);
    assert.equal(works[0].metadataComplete, true);
    // Every exact-title record outranks every non-exact one.
    const firstNonExact = works.findIndex((w) => !w.exactTitleMatch);
    assert.ok(firstNonExact === -1 || works.slice(0, firstNonExact).every((w) => w.exactTitleMatch));
  });

  it("collapses duplicate deposits (incl. a case-variant DOI) into the most complete record, counted", async () => {
    globalThis.fetch = async () => jsonResponse(200, ATTENTION_POOL);
    const r = await callResearch("crossref-search", ctxA, { query: "attention is all you need" });
    const works = r.result.works;
    // The three clone deposits and the canonical-shaped record are
    // deposits of the SAME work (same title + first author): one group,
    // represented by its most complete record — the canonical one.
    assert.equal(works.filter((w) => w.doi.toLowerCase().startsWith("10.65215/")).length, 0,
      JSON.stringify(works.map((w) => w.doi)));
    assert.equal(works[0].doi, "10.1234/nips.2017.7181");
    assert.equal(works[0].duplicatesCollapsed, 3);
    assert.equal(r.result.collapsedCount, 3);
    // The same-titled record by a DIFFERENT author is a different work
    // and is not collapsed into the swarm.
    assert.ok(works.some((w) => w.doi === "10.1201/9781003561460-19"));
    assert.equal(works.length, 4);
  });

  it("with no canonical record in the pool, the clone swarm collapses to its most complete deposit", async () => {
    // The real-world Attention case: Crossref holds only the clones.
    const pool = { message: { "total-results": 938242,
      items: ATTENTION_POOL.message.items.filter((w) => w.DOI !== "10.1234/nips.2017.7181") } };
    globalThis.fetch = async () => jsonResponse(200, pool);
    const r = await callResearch("crossref-search", ctxA, { query: "attention is all you need" });
    const works = r.result.works;
    const clones = works.filter((w) => w.doi.toLowerCase().startsWith("10.65215/"));
    assert.equal(clones.length, 1, JSON.stringify(works.map((w) => w.doi)));
    assert.equal(clones[0].doi, "10.65215/ctdc8e75");
    assert.equal(clones[0].duplicatesCollapsed, 2);
    assert.equal(clones[0].exactTitleMatch, true);
    assert.equal(r.result.collapsedCount, 2);
  });

  it("prefers the complete canonical record over a sparse duplicate deposit of the same work", async () => {
    globalThis.fetch = async () => jsonResponse(200, ALPHAGO_POOL);
    const r = await callResearch("crossref-search", ctxA, {
      query: "Mastering the game of Go with deep neural networks and tree search",
    });
    const works = r.result.works;
    assert.equal(works[0].doi, "10.1038/nature16961");
    assert.equal(works[0].duplicatesCollapsed, 1);
    assert.equal(works[0].citationCount, 11982);
    assert.equal(works.length, 2);
    assert.equal(works[1].doi, "10.1038/nature24270");
  });

  it("answers an empty Crossref page honestly", async () => {
    globalThis.fetch = async () => jsonResponse(200, { message: { "total-results": 0, items: [] } });
    const r = await callResearch("crossref-search", ctxA, { query: "zyzzyva qqqnonexistent" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.result.works, []);
    assert.equal(r.result.total, 0);
    assert.equal(r.result.collapsedCount, 0);
  });

  it("requires a query and reports upstream failure as failure, never as empty results", async () => {
    const missing = await callResearch("crossref-search", ctxA, {});
    assert.equal(missing.ok, false);
    globalThis.fetch = async () => { throw new Error("socket hangup"); };
    const down = await callResearch("crossref-search", ctxA, { query: "attention" });
    assert.equal(down.ok, false);
    assert.match(down.error, /crossref search failed/);
  });
});
