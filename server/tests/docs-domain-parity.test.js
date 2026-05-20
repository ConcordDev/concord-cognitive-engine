// Contract tests for the docs lens — Notion-shape page/block document
// substrate in server/domains/docs.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDocsActions from "../domains/docs.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`docs.${name}`);
  assert.ok(fn, `docs.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerDocsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newPage(ctx = ctxA, over = {}) {
  return call("page-create", ctx, { title: "Project notes", ...over }).result.page;
}

describe("docs.page CRUD", () => {
  it("creates a page scoped per user", () => {
    newPage();
    assert.equal(call("page-list", ctxA, {}).result.count, 1);
    assert.equal(call("page-list", ctxB, {}).result.count, 0);
  });
  it("nests pages and cascades delete to descendants", () => {
    const parent = newPage();
    const child = newPage(ctxA, { title: "Sub", parentId: parent.id });
    assert.equal(call("page-list", ctxA, {}).result.count, 2);
    const del = call("page-delete", ctxA, { id: parent.id });
    assert.equal(del.result.deleted.length, 2);
    assert.ok(del.result.deleted.includes(child.id));
    assert.equal(call("page-list", ctxA, {}).result.count, 0);
  });
  it("page-move rejects self-parenting", () => {
    const p = newPage();
    assert.equal(call("page-move", ctxA, { id: p.id, parentId: p.id }).ok, false);
  });
  it("page-update changes title and icon", () => {
    const p = newPage();
    call("page-update", ctxA, { id: p.id, title: "Renamed", icon: "🚀" });
    assert.equal(call("page-detail", ctxA, { id: p.id }).result.page.title, "Renamed");
  });
});

describe("docs.block editing", () => {
  it("adds typed blocks and lists them on the page", () => {
    const p = newPage();
    call("block-add", ctxA, { pageId: p.id, type: "heading1", text: "Overview" });
    call("block-add", ctxA, { pageId: p.id, type: "todo", text: "Ship it" });
    const page = call("page-detail", ctxA, { id: p.id }).result.page;
    assert.equal(page.blocks.length, 2);
    assert.equal(page.blocks[0].type, "heading1");
    assert.equal(page.blocks[1].type, "todo");
  });
  it("unknown block type falls back to paragraph", () => {
    const p = newPage();
    const b = call("block-add", ctxA, { pageId: p.id, type: "nonsense", text: "x" });
    assert.equal(b.result.block.type, "paragraph");
  });
  it("block-add afterId inserts in place", () => {
    const p = newPage();
    const first = call("block-add", ctxA, { pageId: p.id, text: "first" }).result.block;
    const last = call("block-add", ctxA, { pageId: p.id, text: "last" }).result.block;
    call("block-add", ctxA, { pageId: p.id, text: "middle", afterId: first.id });
    const ids = call("page-detail", ctxA, { id: p.id }).result.page.blocks.map(b => b.text);
    assert.deepEqual(ids, ["first", "middle", "last"]);
    assert.ok(last);
  });
  it("toggles a todo, reorders and deletes blocks", () => {
    const p = newPage();
    const a = call("block-add", ctxA, { pageId: p.id, type: "todo", text: "A" }).result.block;
    const b = call("block-add", ctxA, { pageId: p.id, text: "B" }).result.block;
    call("block-update", ctxA, { pageId: p.id, blockId: a.id, checked: true });
    assert.equal(call("page-detail", ctxA, { id: p.id }).result.page.blocks[0].checked, true);
    call("block-reorder", ctxA, { pageId: p.id, blockId: b.id, direction: "up" });
    assert.equal(call("page-detail", ctxA, { id: p.id }).result.page.blocks[0].id, b.id);
    call("block-delete", ctxA, { pageId: p.id, blockId: a.id });
    assert.equal(call("page-detail", ctxA, { id: p.id }).result.page.blocks.length, 1);
  });
});

describe("docs.search / dashboard", () => {
  it("docs-search matches titles and block content", () => {
    const p = newPage(ctxA, { title: "Roadmap" });
    call("block-add", ctxA, { pageId: p.id, text: "launch the rocket" });
    assert.equal(call("docs-search", ctxA, { query: "roadmap" }).result.count, 1);
    assert.equal(call("docs-search", ctxA, { query: "rocket" }).result.results[0].matchedIn, "content");
  });
  it("docs-dashboard aggregates pages, blocks, todos, words", () => {
    const p = newPage();
    call("block-add", ctxA, { pageId: p.id, type: "todo", text: "one two" });
    call("block-add", ctxA, { pageId: p.id, text: "three four five" });
    const d = call("docs-dashboard", ctxA, {});
    assert.equal(d.result.pages, 1);
    assert.equal(d.result.totalBlocks, 2);
    assert.equal(d.result.openTodos, 1);
    assert.equal(d.result.words, 5);
  });
});

describe("docs — analysis macros still intact", () => {
  it("readabilityScore handles empty text", () => {
    const r = call("readabilityScore", ctxA, {});
    assert.equal(r.ok, true);
  });
});
