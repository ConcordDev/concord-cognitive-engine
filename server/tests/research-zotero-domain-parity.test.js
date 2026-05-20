// Contract tests for the research Zotero 2026-parity reference-manager
// macros (references, collections, tags, reading status, annotations,
// related items, citations). Notes + API macros covered elsewhere.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerResearchActions from "../domains/research.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`research.${name}`);
  assert.ok(fn, `research.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerResearchActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newRef(ctx = ctxA, over = {}) {
  return call("reference-add", ctx, {
    title: "Attention Is All You Need", authors: "Vaswani, A.", year: 2017,
    type: "article", journal: "NeurIPS", doi: "10.5555/3295222", tags: ["ml", "transformers"], ...over,
  }).result.reference;
}

describe("research.reference-* library", () => {
  it("add requires a title, scoped per user", () => {
    assert.equal(call("reference-add", ctxA, {}).ok, false);
    newRef();
    assert.equal(call("reference-list", ctxA, {}).result.count, 1);
    assert.equal(call("reference-list", ctxB, {}).result.count, 0);
  });

  it("list filters by tag and type; search matches title", () => {
    newRef(ctxA, { title: "Paper One", tags: ["nlp"], type: "article" });
    newRef(ctxA, { title: "A Book", tags: ["theory"], type: "book" });
    assert.equal(call("reference-list", ctxA, { tag: "nlp" }).result.count, 1);
    assert.equal(call("reference-list", ctxA, { type: "book" }).result.count, 1);
    assert.equal(call("reference-list", ctxA, { query: "book" }).result.count, 1);
  });

  it("update, detail, delete", () => {
    const r = newRef();
    assert.equal(call("reference-update", ctxA, { id: r.id, year: 2018 }).result.reference.year, 2018);
    const d = call("reference-detail", ctxA, { id: r.id });
    assert.ok(d.result.citations.apa.includes("2018"));
    assert.equal(call("reference-delete", ctxA, { id: r.id }).ok, true);
    assert.equal(call("reference-list", ctxA, {}).result.count, 0);
  });
});

describe("research.reading status", () => {
  it("set status and reading-queue", () => {
    const r1 = newRef();
    const r2 = newRef(ctxA, { title: "Second" });
    call("reference-set-status", ctxA, { id: r1.id, status: "reading" });
    const q = call("reading-queue", ctxA, {});
    assert.equal(q.result.reading, 1);
    assert.equal(q.result.toRead, 1);
    assert.equal(call("reference-set-status", ctxA, { id: r2.id, status: "bogus" }).ok, false);
  });
});

describe("research.tags", () => {
  it("tag-list aggregates counts", () => {
    newRef(ctxA, { tags: ["ml", "nlp"] });
    newRef(ctxA, { title: "B", tags: ["ml"] });
    const tags = call("tag-list", ctxA, {});
    assert.equal(tags.result.tags[0].tag, "ml");
    assert.equal(tags.result.tags[0].count, 2);
  });
});

describe("research.collections", () => {
  it("create, add references, detail", () => {
    const r1 = newRef();
    const r2 = newRef(ctxA, { title: "Second" });
    const col = call("collection-create", ctxA, { name: "Thesis sources" }).result.collection;
    call("collection-add-reference", ctxA, { collectionId: col.id, referenceId: r1.id });
    call("collection-add-reference", ctxA, { collectionId: col.id, referenceId: r2.id });
    assert.equal(call("collection-detail", ctxA, { id: col.id }).result.references.length, 2);
    call("collection-add-reference", ctxA, { collectionId: col.id, referenceId: r1.id, remove: true });
    assert.equal(call("collection-detail", ctxA, { id: col.id }).result.references.length, 1);
    assert.equal(call("collection-delete", ctxA, { id: col.id }).ok, true);
  });
});

describe("research.related + annotations", () => {
  it("relate two references bidirectionally", () => {
    const a = newRef();
    const b = newRef(ctxA, { title: "Second" });
    call("reference-relate", ctxA, { referenceId: a.id, relatedId: b.id });
    assert.equal(call("reference-related", ctxA, { id: a.id }).result.count, 1);
    assert.equal(call("reference-related", ctxA, { id: b.id }).result.count, 1);
    assert.equal(call("reference-relate", ctxA, { referenceId: a.id, relatedId: a.id }).ok, false);
  });

  it("annotations attach to a reference", () => {
    const r = newRef();
    call("annotation-add", ctxA, { referenceId: r.id, page: 3, quote: "key claim", color: "green" });
    assert.equal(call("annotation-list", ctxA, { referenceId: r.id }).result.count, 1);
    assert.equal(call("annotation-add", ctxA, { referenceId: r.id }).ok, false);
  });
});

describe("research.citations", () => {
  it("formats APA, MLA and BibTeX", () => {
    const r = newRef();
    assert.ok(call("cite-format", ctxA, { id: r.id, style: "apa" }).result.citation.includes("(2017)"));
    assert.ok(call("cite-format", ctxA, { id: r.id, style: "mla" }).result.citation.includes('"Attention'));
    const bib = call("cite-format", ctxA, { id: r.id, style: "bibtex" }).result.citation;
    assert.ok(bib.startsWith("@article{"));
  });

  it("bibliography-build assembles a sorted list", () => {
    newRef(ctxA, { authors: "Zhang, X." });
    newRef(ctxA, { authors: "Adams, B.", title: "Earlier author" });
    const bib = call("bibliography-build", ctxA, { style: "apa" });
    assert.equal(bib.result.count, 2);
    assert.ok(bib.result.entries[0].startsWith("Adams")); // alphabetical by author
  });
});

describe("research.library-stats", () => {
  it("aggregates the library", () => {
    newRef(ctxA, { type: "article" });
    const b = newRef(ctxA, { type: "book", title: "B" });
    call("reference-set-status", ctxA, { id: b.id, status: "read" });
    call("collection-create", ctxA, { name: "C" });
    const stats = call("library-stats", ctxA, {});
    assert.equal(stats.result.references, 2);
    assert.equal(stats.result.byType.book, 1);
    assert.equal(stats.result.byStatus.read, 1);
    assert.equal(stats.result.collections, 1);
  });
});
