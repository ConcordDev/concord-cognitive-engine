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
