import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/research.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

// S6 (F7) — canvas that behaves like a canvas. Server-side claims:
//  (a) Card positions persist through canvas-save → canvas-get exactly
//      (the drag-persist shape: save moved coordinates, reload, same
//      coordinates) — this machinery existed; the slice pins it.
//  (b) Note cards (kind "note" + noteId) round-trip — the schema always
//      allowed them; the frontend never created them.
//  (c) Reference cards (kind "reference" + referenceId) round-trip —
//      the field did NOT exist pre-S6: the sanitiser coerced the kind
//      to "text" and dropped referenceId, so a reference card could
//      not be stored at all. S6 extends the sanitiser minimally.
//  (d) Edges (card links) round-trip and are counted by canvas-list —
//      the board list always advertised "N links"; the data path is
//      pinned here so the new link UI stands on verified storage.
//  (e) Canvases are per-user: another user cannot read or list them.

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`research.${name}`);
  if (!fn) throw new Error(`research.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  clearExternalFetchCache();
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

describe("research — canvas cards (S6)", () => {
  it("persists card positions through save → get (drag-persist shape)", () => {
    const c = call("canvas-save", ctxA, {
      name: "Layout",
      cards: [
        { id: "a", kind: "text", text: "one", x: 40, y: 40, w: 180, h: 110 },
        { id: "b", kind: "text", text: "two", x: 300, y: 190, w: 180, h: 110 },
      ],
      edges: [],
    });
    assert.equal(c.ok, true, JSON.stringify(c));
    const id = c.result.canvas.id;
    // The drag: card "a" is dropped somewhere else and the board re-saved.
    const moved = c.result.canvas.cards.map((k) =>
      k.id === "a" ? { ...k, x: 512, y: 264 } : k);
    const u = call("canvas-save", ctxA, { id, name: "Layout", cards: moved, edges: [] });
    assert.equal(u.ok, true);
    const g = call("canvas-get", ctxA, { id });
    const a = g.result.canvas.cards.find((k) => k.id === "a");
    const b = g.result.canvas.cards.find((k) => k.id === "b");
    assert.equal(a.x, 512);
    assert.equal(a.y, 264);
    assert.equal(b.x, 300);
    assert.equal(b.y, 190);
  });

  it("round-trips a note card (kind + noteId)", () => {
    const n = call("note-create", ctxA, { title: "Reading notes", body: "Body text here." });
    assert.equal(n.ok, true, JSON.stringify(n));
    const noteId = n.result.note.id;
    const c = call("canvas-save", ctxA, {
      name: "Notes board",
      cards: [{ id: "n1", kind: "note", noteId, text: "", x: 10, y: 10 }],
      edges: [],
    });
    const g = call("canvas-get", ctxA, { id: c.result.canvas.id });
    assert.equal(g.result.canvas.cards[0].kind, "note");
    assert.equal(g.result.canvas.cards[0].noteId, noteId);
  });

  it("round-trips a reference card (kind + referenceId)", () => {
    const r = call("reference-add", ctxA, {
      title: "Attention Is All You Need", authors: "Ashish Vaswani", year: 2017,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    const referenceId = r.result.reference.id;
    const c = call("canvas-save", ctxA, {
      name: "Refs board",
      cards: [{ id: "r1", kind: "reference", referenceId, text: "", x: 20, y: 20 }],
      edges: [],
    });
    const g = call("canvas-get", ctxA, { id: c.result.canvas.id });
    assert.equal(g.result.canvas.cards[0].kind, "reference");
    assert.equal(g.result.canvas.cards[0].referenceId, referenceId);
  });

  it("round-trips edges and counts them in canvas-list", () => {
    const c = call("canvas-save", ctxA, {
      name: "Linked",
      cards: [
        { id: "a", kind: "text", text: "one", x: 0, y: 0 },
        { id: "b", kind: "text", text: "two", x: 200, y: 0 },
      ],
      edges: [{ id: "e1", from: "a", to: "b", label: "" }],
    });
    assert.equal(c.ok, true);
    const g = call("canvas-get", ctxA, { id: c.result.canvas.id });
    assert.equal(g.result.canvas.edges.length, 1);
    assert.equal(g.result.canvas.edges[0].from, "a");
    assert.equal(g.result.canvas.edges[0].to, "b");
    const l = call("canvas-list", ctxA);
    const row = l.result.canvases.find((v) => v.id === c.result.canvas.id);
    assert.equal(row.edgeCount, 1);
    assert.equal(row.cardCount, 2);
  });

  it("still coerces an unknown card kind to text (sanitiser contract)", () => {
    const c = call("canvas-save", ctxA, {
      name: "Junk kind",
      cards: [{ id: "j", kind: "spreadsheet", text: "x", x: 0, y: 0 }],
      edges: [],
    });
    const g = call("canvas-get", ctxA, { id: c.result.canvas.id });
    assert.equal(g.result.canvas.cards[0].kind, "text");
    assert.equal(g.result.canvas.cards[0].referenceId, null);
  });

  it("scopes canvases per user", () => {
    const c = call("canvas-save", ctxA, { name: "Private", cards: [], edges: [] });
    const id = c.result.canvas.id;
    const gB = call("canvas-get", ctxB, { id });
    assert.equal(gB.ok, false);
    const lB = call("canvas-list", ctxB);
    assert.equal(lB.result.canvases.length, 0);
  });
});
