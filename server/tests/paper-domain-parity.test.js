// Tier-2 contract test for the paper lens.
//
// Covers paper.search (real arXiv export API) plus the seven
// feature-parity backlog macros: PDF attachment + reader, PDF
// annotation, one-click DOI capture, Semantic Scholar enrichment,
// duplicate detection + merge, shared group libraries, and
// cited-by alerts.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPaperActions from "../domains/paper.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`paper.${name}`);
  if (!fn) throw new Error(`paper.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPaperActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctx = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

// A 1x1 transparent PDF-typed data URL (payload irrelevant; the macro
// only validates the data:application/pdf prefix and the size cap).
const PDF_DATA_URL = "data:application/pdf;base64," + "A".repeat(2000);

function saveOne(c = ctx, over = {}) {
  return call("paper-save", c, {
    title: "Attention Is All You Need", authors: ["Vaswani"], year: 2017,
    refId: "attention-2017", ...over,
  }).result.paper;
}

describe("paper.search (arXiv live)", () => {
  it("rejects empty query", async () => {
    const r = await call("search", ctx, { query: "" });
    assert.equal(r.ok, false);
    assert.match(r.error, /query required/);
  });

  it("returns error when network is disabled (hermetic test)", async () => {
    const r = await call("search", ctx, { query: "attention is all you need" });
    assert.equal(r.ok, false);
    assert.match(r.error, /failed|network/);
  });

  it("parses arXiv Atom XML response", async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /export\.arxiv\.org\/api\/query/);
      assert.match(url, /search_query=all%3Aattention/);
      return {
        ok: true,
        text: async () => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v5</id>
    <updated>2017-12-06T19:32:32Z</updated>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models are based on complex recurrent or convolutional neural networks…</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v5"/>
    <arxiv:primary_category term="cs.CL"/>
  </entry>
</feed>`,
      };
    };
    const r = await call("search", ctx, { query: "attention" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "arXiv export API");
    assert.equal(r.result.papers.length, 1);
    assert.equal(r.result.papers[0].title, "Attention Is All You Need");
    assert.equal(r.result.papers[0].authors.length, 2);
    assert.equal(r.result.papers[0].authors[0], "Ashish Vaswani");
    assert.equal(r.result.papers[0].id, "1706.03762v5");
    assert.equal(r.result.papers[0].primaryCategory, "cs.CL");
    assert.match(r.result.papers[0].pdfUrl, /pdf\/1706\.03762/);
  });

  it("returns empty array (not fake fallback) when no matches", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`,
    });
    const r = await call("search", ctx, { query: "asdfqwerzxcv" });
    assert.equal(r.ok, true);
    assert.equal(r.result.papers.length, 0);
  });
});

// ─── Backlog item 1: PDF attachment + in-app reader ─────────────────
describe("paper.pdf attachment", () => {
  it("attaches, reads back, and removes a PDF", () => {
    const p = saveOne();
    const a = call("paper-pdf-attach", ctx, { paperId: p.id, dataUrl: PDF_DATA_URL, fileName: "x.pdf" });
    assert.equal(a.ok, true);
    assert.equal(a.result.fileName, "x.pdf");
    assert.ok(a.result.sizeBytes > 0);
    const g = call("paper-pdf-get", ctx, { paperId: p.id });
    assert.equal(g.result.hasPdf, true);
    assert.equal(g.result.dataUrl, PDF_DATA_URL);
    const rm = call("paper-pdf-remove", ctx, { paperId: p.id });
    assert.equal(rm.result.removed, true);
    assert.equal(call("paper-pdf-get", ctx, { paperId: p.id }).result.hasPdf, false);
  });

  it("rejects a non-PDF data URL", () => {
    const p = saveOne();
    const r = call("paper-pdf-attach", ctx, { paperId: p.id, dataUrl: "data:image/png;base64,AAAA" });
    assert.equal(r.ok, false);
  });
});

// ─── Backlog item 2: PDF annotation + highlights synced to notes ────
describe("paper.annotations", () => {
  it("adds, lists, syncs to notes, and deletes annotations", () => {
    const p = saveOne();
    const a = call("paper-annotate", ctx, { paperId: p.id, page: 3, quote: "key claim", comment: "important", color: "green" });
    assert.equal(a.ok, true);
    assert.equal(a.result.annotation.page, 3);
    assert.equal(a.result.annotation.color, "green");
    const list = call("paper-annotations", ctx, { paperId: p.id });
    assert.equal(list.result.count, 1);
    const sync = call("paper-annotations-sync", ctx, { paperId: p.id });
    assert.equal(sync.result.synced, 1);
    assert.match(sync.result.notes, /## Highlights/);
    assert.match(sync.result.notes, /key claim/);
    const del = call("paper-annotation-delete", ctx, { paperId: p.id, annotationId: a.result.annotation.id });
    assert.equal(del.result.remaining, 0);
  });

  it("rejects an empty quote", () => {
    const p = saveOne();
    assert.equal(call("paper-annotate", ctx, { paperId: p.id, quote: "" }).ok, false);
  });
});

// ─── Backlog item 3: one-click capture from DOI/URL ─────────────────
describe("paper.paper-capture", () => {
  it("rejects an unparseable DOI", async () => {
    const r = await call("paper-capture", ctx, { url: "not a doi" });
    assert.equal(r.ok, false);
  });

  it("captures CrossRef metadata into the library", async () => {
    globalThis.fetch = async (url) => {
      assert.match(String(url), /api\.crossref\.org\/works/);
      return {
        ok: true,
        json: async () => ({
          message: {
            title: ["Deep learning"], author: [{ given: "Yann", family: "LeCun" }],
            issued: { "date-parts": [[2015]] }, "container-title": ["Nature"],
            DOI: "10.1038/nature14539", URL: "https://doi.org/10.1038/nature14539",
            "is-referenced-by-count": 1234,
          },
        }),
      };
    };
    const r = await call("paper-capture", ctx, { doi: "10.1038/nature14539" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "crossref");
    assert.equal(r.result.paper.title, "Deep learning");
    assert.equal(r.result.paper.year, 2015);
    assert.equal(r.result.paper.doi, "10.1038/nature14539");
    assert.equal(call("paper-list", ctx, {}).result.count, 1);
  });
});

// ─── Backlog item 4: Semantic Scholar enrichment ────────────────────
describe("paper.paper-enrich", () => {
  it("rejects a paper with no DOI or arXiv id", async () => {
    const p = saveOne();
    const r = await call("paper-enrich", ctx, { paperId: p.id });
    assert.equal(r.ok, false);
  });

  it("attaches citation counts + references from Semantic Scholar", async () => {
    const p = saveOne(ctx, { doi: "10.1000/xyz" });
    globalThis.fetch = async (url) => {
      assert.match(String(url), /api\.semanticscholar\.org/);
      return {
        ok: true,
        json: async () => ({
          citationCount: 99, influentialCitationCount: 12, referenceCount: 30,
          fieldsOfStudy: ["Computer Science"],
          tldr: { text: "A transformer paper." },
          references: [{ title: "Seq2Seq", year: 2014 }],
          citations: [{ title: "BERT", year: 2018 }],
        }),
      };
    };
    const r = await call("paper-enrich", ctx, { paperId: p.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.enrichment.citationCount, 99);
    assert.equal(r.result.enrichment.influentialCitationCount, 12);
    assert.equal(r.result.enrichment.references[0].title, "Seq2Seq");
    assert.equal(r.result.enrichment.citations[0].title, "BERT");
  });
});

// ─── Backlog item 5: duplicate detection + dedupe ───────────────────
describe("paper.duplicate detection", () => {
  it("finds duplicates by normalised title and merges them", () => {
    const a = saveOne(ctx, { refId: "a" });
    const b = saveOne(ctx, { refId: "b", title: "Attention   Is All You Need" });
    const dups = call("paper-find-duplicates", ctx, {});
    assert.equal(dups.result.groupCount, 1);
    assert.equal(dups.result.duplicateGroups[0].members.length, 2);
    const merged = call("paper-merge-duplicates", ctx, { ids: [a.id, b.id] });
    assert.equal(merged.ok, true);
    assert.equal(merged.result.droppedCount, 1);
    assert.equal(call("paper-list", ctx, {}).result.count, 1);
  });

  it("rejects a merge of fewer than 2 ids", () => {
    const a = saveOne();
    assert.equal(call("paper-merge-duplicates", ctx, { ids: [a.id] }).ok, false);
  });
});

// ─── Backlog item 6: shared / group libraries ───────────────────────
describe("paper.group libraries", () => {
  it("creates a group, joins via share code, and shares papers", () => {
    const g = call("group-create", ctx, { name: "Reading Circle" }).result.group;
    assert.ok(g.shareCode);
    const joined = call("group-join", ctxB, { shareCode: g.shareCode });
    assert.equal(joined.ok, true);
    assert.equal(joined.result.group.memberCount, 2);
    const p = saveOne();
    const added = call("group-add-paper", ctx, { groupId: g.id, paperId: p.id });
    assert.equal(added.result.paperCount, 1);
    // member B sees the shared paper
    const seen = call("group-papers", ctxB, { groupId: g.id });
    assert.equal(seen.result.papers.length, 1);
    const removed = call("group-remove-paper", ctx, { groupId: g.id, paperId: added.result.paper.id });
    assert.equal(removed.result.paperCount, 0);
  });

  it("rejects an unnamed group and a bad join code", () => {
    assert.equal(call("group-create", ctx, {}).ok, false);
    assert.equal(call("group-join", ctx, { shareCode: "NOPE9999" }).ok, false);
  });
});

// ─── Backlog item 7: cited-by + new-version alerts ──────────────────
describe("paper.alerts", () => {
  it("detects new citations and records an alert", async () => {
    const p = saveOne(ctx, { doi: "10.2000/abc" });
    p.lastCitationCount = 5;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ citationCount: 8, citations: [] }),
    });
    const r = await call("paper-check-alerts", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.newAlertCount, 1);
    assert.equal(r.result.newAlerts[0].delta, 3);
    const list = call("paper-alerts-list", ctx, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.unread, 1);
    const read = call("paper-alert-read", ctx, { alertId: r.result.newAlerts[0].id });
    assert.equal(read.result.read, true);
    assert.equal(call("paper-alerts-list", ctx, {}).result.unread, 0);
  });

  it("lists no alerts before a check is run", () => {
    saveOne();
    const list = call("paper-alerts-list", ctx, {});
    assert.equal(list.result.count, 0);
  });
});
