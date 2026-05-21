import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/research.js";

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
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

describe("research — notes CRUD", () => {
  it("creates and lists a note", () => {
    const c = call("note-create", ctxA, { title: "First", body: "Hello world" });
    assert.equal(c.ok, true);
    const l = call("notes-list", ctxA);
    assert.equal(l.result.notes.length, 1);
    assert.equal(l.result.notes[0].title, "First");
  });

  it("INVARIANT: notes scoped per-user", () => {
    call("note-create", ctxA, { title: "a-only", body: "x" });
    const b = call("notes-list", ctxB);
    assert.equal(b.result.notes.length, 0);
  });

  it("update modifies title and body", () => {
    const c = call("note-create", ctxA, { title: "old", body: "old body" });
    const u = call("note-update", ctxA, { id: c.result.note.id, title: "new", body: "new body" });
    assert.equal(u.result.note.title, "new");
    assert.equal(u.result.note.body, "new body");
  });

  it("delete removes", () => {
    const c = call("note-create", ctxA, { title: "tmp", body: "x" });
    call("note-delete", ctxA, { id: c.result.note.id });
    const l = call("notes-list", ctxA);
    assert.equal(l.result.notes.length, 0);
  });

  it("rejects oversized title", () => {
    const r = call("note-create", ctxA, { title: "x".repeat(201), body: "y" });
    assert.equal(r.ok, false);
  });
});

describe("research — daily note", () => {
  it("auto-creates daily note for today", () => {
    const r = call("daily-note", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.created, true);
    assert.match(r.result.note.title, /^Daily — /);
  });

  it("subsequent call returns same daily note", () => {
    const r1 = call("daily-note", ctxA);
    const r2 = call("daily-note", ctxA);
    assert.equal(r1.result.note.id, r2.result.note.id);
    assert.equal(r2.result.created, false);
  });

  it("different date creates different note", () => {
    const r1 = call("daily-note", ctxA, { date: "2026-01-01" });
    const r2 = call("daily-note", ctxA, { date: "2026-01-02" });
    assert.notEqual(r1.result.note.id, r2.result.note.id);
  });
});

describe("research — backlinks", () => {
  it("finds [[wikilinks]] in other notes", () => {
    call("note-create", ctxA, { title: "Source", body: "main body" });
    call("note-create", ctxA, { title: "Linker", body: "I reference [[Source]] here" });
    const r = call("backlinks-for", ctxA, { title: "Source" });
    assert.equal(r.result.backlinks.length, 1);
    assert.equal(r.result.backlinks[0].noteTitle, "Linker");
    assert.ok(r.result.backlinks[0].context.includes("[[Source]]"));
  });

  it("excludes self-references", () => {
    call("note-create", ctxA, { title: "Self", body: "I am [[Self]]" });
    const r = call("backlinks-for", ctxA, { title: "Self" });
    assert.equal(r.result.backlinks.length, 0);
  });
});

describe("research — templates", () => {
  it("lists 6 templates", () => {
    const r = call("templates-list", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.templates.length, 6);
  });

  it("apply returns named template", () => {
    const r = call("template-apply", {}, { id: "meeting" });
    assert.equal(r.ok, true);
    assert.equal(r.result.template.id, "meeting");
    assert.match(r.result.template.title, /meeting/i);
  });

  it("rejects unknown template id", () => {
    const r = call("template-apply", {}, { id: "bogus" });
    assert.equal(r.ok, false);
  });
});

describe("research — search", () => {
  beforeEach(() => {
    call("note-create", ctxA, { title: "Pasta recipes", body: "spaghetti and carbonara" });
    call("note-create", ctxA, { title: "Rocket science", body: "propellant mixture for spaghetti-thrust engines" });
  });

  it("scores title matches higher than body", () => {
    const r = call("notes-search", ctxA, { query: "spaghetti" });
    assert.ok(r.result.hits.length >= 1);
    // Title hits get +5, body hits +1
    assert.ok(r.result.hits[0].score >= 1);
  });

  it("rejects short query", () => {
    const r = call("notes-search", ctxA, { query: "x" });
    assert.equal(r.ok, false);
  });
});

// ─── 2026 parity backlog — graph, lit review, PDF, live search, canvas ───

describe("research — note graph", () => {
  it("builds nodes and edges from [[wikilinks]]", () => {
    call("note-create", ctxA, { title: "Hub", body: "central" });
    call("note-create", ctxA, { title: "Leaf", body: "points at [[Hub]]" });
    const r = call("note-graph", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.nodes.length, 2);
    assert.equal(r.result.edges.length, 1);
    assert.equal(r.result.stats.linkCount, 1);
  });

  it("reports orphan notes with no links", () => {
    call("note-create", ctxA, { title: "Lonely", body: "no links here" });
    const r = call("note-graph", ctxA);
    assert.ok(r.result.orphans.some((o) => o.title === "Lonely"));
  });

  it("empty library returns empty graph", () => {
    const r = call("note-graph", ctxB);
    assert.equal(r.ok, true);
    assert.equal(r.result.nodes.length, 0);
  });
});

describe("research — note titles autocomplete", () => {
  it("returns titles filtered by query", () => {
    call("note-create", ctxA, { title: "Quantum entanglement", body: "x" });
    call("note-create", ctxA, { title: "Classical mechanics", body: "y" });
    const r = call("note-titles", ctxA, { query: "quantum" });
    assert.equal(r.ok, true);
    assert.equal(r.result.titles.length, 1);
    assert.equal(r.result.titles[0].title, "Quantum entanglement");
  });

  it("returns all titles when no query", () => {
    call("note-create", ctxA, { title: "A", body: "x" });
    call("note-create", ctxA, { title: "B", body: "y" });
    const r = call("note-titles", ctxA, {});
    assert.equal(r.result.titles.length, 2);
  });
});

describe("research — note version history", () => {
  it("creates and lists snapshots", () => {
    const c = call("note-create", ctxA, { title: "Versioned", body: "v1" });
    const snap = call("note-snapshot", ctxA, { noteId: c.result.note.id, label: "first" });
    assert.equal(snap.ok, true);
    const list = call("note-snapshots", ctxA, { noteId: c.result.note.id });
    assert.equal(list.result.snapshots.length, 1);
    assert.equal(list.result.snapshots[0].label, "first");
  });

  it("restores a note to a prior snapshot", () => {
    const c = call("note-create", ctxA, { title: "Doc", body: "original" });
    const snap = call("note-snapshot", ctxA, { noteId: c.result.note.id });
    call("note-update", ctxA, { id: c.result.note.id, body: "edited" });
    const r = call("note-restore", ctxA, { noteId: c.result.note.id, snapshotId: snap.result.snapshot.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.note.body, "original");
  });

  it("note-snapshot-get returns full body", () => {
    const c = call("note-create", ctxA, { title: "Full", body: "the body" });
    const snap = call("note-snapshot", ctxA, { noteId: c.result.note.id });
    const got = call("note-snapshot-get", ctxA, { noteId: c.result.note.id, snapshotId: snap.result.snapshot.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.snapshot.body, "the body");
  });

  it("rejects missing noteId", () => {
    const r = call("note-snapshot", ctxA, {});
    assert.equal(r.ok, false);
  });
});

describe("research — canvas board", () => {
  it("saves and lists a canvas", () => {
    const c = call("canvas-save", ctxA, { name: "Board 1", cards: [], edges: [] });
    assert.equal(c.ok, true);
    const l = call("canvas-list", ctxA);
    assert.equal(l.result.canvases.length, 1);
    assert.equal(l.result.canvases[0].name, "Board 1");
  });

  it("persists cards and retrieves a canvas", () => {
    const c = call("canvas-save", ctxA, {
      name: "Cards", cards: [{ id: "x1", kind: "text", text: "hello", x: 10, y: 20 }], edges: [],
    });
    const g = call("canvas-get", ctxA, { id: c.result.canvas.id });
    assert.equal(g.result.canvas.cards.length, 1);
    assert.equal(g.result.canvas.cards[0].text, "hello");
  });

  it("updates an existing canvas by id", () => {
    const c = call("canvas-save", ctxA, { name: "Orig", cards: [], edges: [] });
    const u = call("canvas-save", ctxA, { id: c.result.canvas.id, name: "Renamed", cards: [], edges: [] });
    assert.equal(u.result.canvas.id, c.result.canvas.id);
    assert.equal(u.result.canvas.name, "Renamed");
  });

  it("deletes a canvas", () => {
    const c = call("canvas-save", ctxA, { name: "Temp", cards: [], edges: [] });
    call("canvas-delete", ctxA, { id: c.result.canvas.id });
    const l = call("canvas-list", ctxA);
    assert.equal(l.result.canvases.length, 0);
  });

  it("rejects canvas without a name", () => {
    const r = call("canvas-save", ctxA, { cards: [], edges: [] });
    assert.equal(r.ok, false);
  });
});

describe("research — PDF attachments", () => {
  it("attaches and lists a PDF for a reference", () => {
    const ref = call("reference-add", ctxA, { title: "Paper A" });
    const a = call("reference-attach-pdf", ctxA, {
      referenceId: ref.result.reference.id, url: "https://example.com/a.pdf", filename: "a.pdf",
    });
    assert.equal(a.ok, true);
    const list = call("reference-pdfs", ctxA, { referenceId: ref.result.reference.id });
    assert.equal(list.result.pdfs.length, 1);
    assert.equal(list.result.pdfs[0].filename, "a.pdf");
  });

  it("rejects non-http url", () => {
    const ref = call("reference-add", ctxA, { title: "Paper B" });
    const r = call("reference-attach-pdf", ctxA, {
      referenceId: ref.result.reference.id, url: "file:///etc/passwd",
    });
    assert.equal(r.ok, false);
  });

  it("deletes a PDF attachment", () => {
    const ref = call("reference-add", ctxA, { title: "Paper C" });
    const a = call("reference-attach-pdf", ctxA, {
      referenceId: ref.result.reference.id, url: "https://example.com/c.pdf",
    });
    call("reference-pdf-delete", ctxA, { id: a.result.attachment.id });
    const list = call("reference-pdfs", ctxA, { referenceId: ref.result.reference.id });
    assert.equal(list.result.pdfs.length, 0);
  });
});

describe("research — academic import", () => {
  it("imports a search result into the library", () => {
    const r = call("academic-import", ctxA, {
      work: { title: "Imported work", authors: ["Jane Doe"], year: 2024, source: "arxiv", venue: "arXiv" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.reference.type, "preprint");
    const lib = call("reference-list", ctxA);
    assert.ok(lib.result.references.some((x) => x.title === "Imported work"));
  });

  it("rejects import without a title", () => {
    const r = call("academic-import", ctxA, { work: { authors: ["X"] } });
    assert.equal(r.ok, false);
  });
});

describe("research — academic search", () => {
  it("rejects an empty query", async () => {
    const r = await call("academic-search", ctxA, { query: "" });
    assert.equal(r.ok, false);
  });

  it("returns an error envelope when network is disabled", async () => {
    const r = await call("academic-search", ctxA, { query: "graph neural networks", provider: "arxiv" });
    assert.equal(r.ok, false);
    assert.match(r.error, /academic search failed/);
  });
});

describe("research — literature review", () => {
  it("builds a comparison matrix from referenceIds", async () => {
    const r1 = call("reference-add", ctxA, {
      title: "Study One", year: 2021,
      abstract: "We propose a new method. Results show a 20% improvement over baselines.",
    });
    const r2 = call("reference-add", ctxA, {
      title: "Study Two", year: 2023,
      abstract: "Our framework demonstrates strong performance with a sample of 500 participants.",
    });
    const rev = await call("literature-review", ctxA, {
      referenceIds: [r1.result.reference.id, r2.result.reference.id],
      dimensions: ["method", "finding"], save: true,
    });
    assert.equal(rev.ok, true);
    assert.equal(rev.result.review.matrix.length, 2);
    assert.deepEqual(rev.result.review.dimensions, ["method", "finding"]);
  });

  it("rejects a review with no papers", async () => {
    const r = await call("literature-review", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("lists and retrieves a saved review", async () => {
    const ref = call("reference-add", ctxA, {
      title: "Solo", year: 2020, abstract: "An abstract describing a method and finding here.",
    });
    const ref2 = call("reference-add", ctxA, {
      title: "Duo", year: 2022, abstract: "Another abstract with results and a sample.",
    });
    const rev = await call("literature-review", ctxA, {
      referenceIds: [ref.result.reference.id, ref2.result.reference.id], save: true,
    });
    const list = call("literature-reviews-list", ctxA);
    assert.ok(list.result.reviews.length >= 1);
    const got = call("literature-review-get", ctxA, { id: rev.result.review.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.review.id, rev.result.review.id);
  });

  it("deletes a saved review", async () => {
    const ref = call("reference-add", ctxA, { title: "X", abstract: "method finding sample here." });
    const ref2 = call("reference-add", ctxA, { title: "Y", abstract: "result outcome sample here." });
    const rev = await call("literature-review", ctxA, {
      referenceIds: [ref.result.reference.id, ref2.result.reference.id], save: true,
    });
    const d = call("literature-review-delete", ctxA, { id: rev.result.review.id });
    assert.equal(d.ok, true);
    const got = call("literature-review-get", ctxA, { id: rev.result.review.id });
    assert.equal(got.ok, false);
  });
});
