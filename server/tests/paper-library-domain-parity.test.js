// Contract tests for the paper lens — Semantic Scholar / Zotero-shape
// paper library substrate in server/domains/paper.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPaperActions from "../domains/paper.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`paper.${name}`);
  assert.ok(fn, `paper.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPaperActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function savePaper(ctx = ctxA, over = {}) {
  return call("paper-save", ctx, {
    title: "Attention Is All You Need", authors: ["Vaswani", "Shazeer"], year: 2017,
    venue: "NeurIPS", refId: "attention-2017", ...over,
  }).result.paper;
}

describe("paper.paper library CRUD", () => {
  it("saves a paper scoped per user", () => {
    savePaper();
    assert.equal(call("paper-list", ctxA, {}).result.count, 1);
    assert.equal(call("paper-list", ctxB, {}).result.count, 0);
  });
  it("FIX-paper-003: an invalid year is refused by name; a valid or absent year saves", () => {
    const bad = call("paper-save", ctxA, { title: "Bad Year", refId: "bad-year-1", year: "abcd" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /whole calendar year/);
    const five = call("paper-save", ctxA, { title: "Far Future", refId: "bad-year-2", year: 99999 });
    assert.equal(five.ok, false);
    const okYear = call("paper-save", ctxA, { title: "Good Year", refId: "good-year", year: 2024 });
    assert.equal(okYear.ok, true);
    assert.equal(okYear.result.paper.year, 2024);
    const noYear = call("paper-save", ctxA, { title: "No Year", refId: "no-year" });
    assert.equal(noYear.ok, true);
    assert.equal(noYear.result.paper.year, null);
    assert.equal(call("paper-list", ctxA, {}).result.count, 2);
  });
  it("rejects a titleless or duplicate paper", () => {
    assert.equal(call("paper-save", ctxA, {}).ok, false);
    savePaper();
    assert.equal(call("paper-save", ctxA, { title: "dup", refId: "attention-2017" }).ok, false);
  });
  it("updates status/rating/notes and deletes", () => {
    const p = savePaper();
    assert.equal(p.status, "to_read");
    call("paper-update", ctxA, { id: p.id, status: "read", rating: 5, notes: "seminal" });
    const d = call("paper-detail", ctxA, { id: p.id }).result.paper;
    assert.equal(d.status, "read");
    assert.equal(d.rating, 5);
    call("paper-delete", ctxA, { id: p.id });
    assert.equal(call("paper-list", ctxA, {}).result.count, 0);
  });
  it("filters paper-list by status", () => {
    const p = savePaper();
    savePaper(ctxA, { title: "Second", refId: "second" });
    call("paper-update", ctxA, { id: p.id, status: "reading" });
    assert.equal(call("paper-list", ctxA, { status: "reading" }).result.count, 1);
  });
});

describe("paper.collections", () => {
  it("creates collections and assigns papers", () => {
    const p = savePaper();
    const c = call("collection-create", ctxA, { name: "Transformers" }).result.collection;
    call("collection-assign", ctxA, { paperId: p.id, collectionId: c.id });
    assert.equal(call("collection-list", ctxA, {}).result.collections[0].paperCount, 1);
    assert.equal(call("paper-list", ctxA, { collectionId: c.id }).result.count, 1);
    call("collection-assign", ctxA, { paperId: p.id, collectionId: c.id, remove: true });
    assert.equal(call("paper-list", ctxA, { collectionId: c.id }).result.count, 0);
  });
  it("rejects an unnamed collection", () => {
    assert.equal(call("collection-create", ctxA, {}).ok, false);
  });
});

describe("paper.library-dashboard", () => {
  it("aggregates reading-status buckets", () => {
    const p = savePaper();
    savePaper(ctxA, { title: "Two", refId: "two" });
    call("paper-update", ctxA, { id: p.id, status: "read", notes: "n" });
    const d = call("library-dashboard", ctxA, {});
    assert.equal(d.result.totalPapers, 2);
    assert.equal(d.result.read, 1);
    assert.equal(d.result.toRead, 1);
    assert.equal(d.result.withNotes, 1);
  });
});
