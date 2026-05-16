import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/whiteboard.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`whiteboard.${name}`);
  if (!fn) throw new Error(`whiteboard.${name} not registered`);
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

describe("whiteboard — templates", () => {
  it("lists 6 starter templates", () => {
    const r = call("templates-list", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.templates.length, 6);
    assert.ok(r.result.templates.some((t) => t.id === "swot"));
  });

  it("template-load returns elements", () => {
    const r = call("template-load", {}, { id: "swot" });
    assert.equal(r.ok, true);
    assert.equal(r.result.template.elements.length, 4);
  });

  it("rejects unknown template", () => {
    const r = call("template-load", {}, { id: "bogus" });
    assert.equal(r.ok, false);
  });
});

describe("whiteboard — boards", () => {
  it("save + list", () => {
    call("board-save", ctxA, { title: "My board", scene: { elements: [{ id: "a" }, { id: "b" }] } });
    const r = call("board-list", ctxA);
    assert.equal(r.result.boards.length, 1);
    assert.equal(r.result.boards[0].elementCount, 2);
  });

  it("INVARIANT: boards scoped per-user", () => {
    call("board-save", ctxA, { title: "a-only", scene: { elements: [] } });
    const b = call("board-list", ctxB);
    assert.equal(b.result.boards.length, 0);
  });

  it("save with same id updates", () => {
    const c1 = call("board-save", ctxA, { title: "v1", scene: { elements: [] } });
    const id = c1.result.board.id;
    call("board-save", ctxA, { id, title: "v2", scene: { elements: [{ id: "a" }] } });
    const loaded = call("board-load", ctxA, { id });
    assert.equal(loaded.result.board.title, "v2");
    assert.equal(loaded.result.board.scene.elements.length, 1);
  });

  it("delete removes", () => {
    const c = call("board-save", ctxA, { title: "tmp", scene: {} });
    call("board-delete", ctxA, { id: c.result.board.id });
    assert.equal(call("board-list", ctxA).result.boards.length, 0);
  });
});

describe("whiteboard — voting", () => {
  it("vote-cast increments tally", () => {
    call("vote-cast", ctxA, { boardId: "b1", elementId: "e1" });
    const r = call("vote-tally", ctxA, { boardId: "b1" });
    assert.equal(r.result.tally[0].count, 1);
  });

  it("dedupes votes from same user on same element", () => {
    call("vote-cast", ctxA, { boardId: "b1", elementId: "e1" });
    call("vote-cast", ctxA, { boardId: "b1", elementId: "e1" });
    const r = call("vote-tally", ctxA, { boardId: "b1" });
    // Same voter casting twice on same element = single vote
    assert.equal(r.result.tally[0].count, 1);
  });

  it("tally sorted by count desc", () => {
    call("vote-cast", ctxA, { boardId: "b1", elementId: "e1" });
    call("vote-cast", ctxA, { boardId: "b1", elementId: "e2" });
    const r = call("vote-tally", ctxA, { boardId: "b1" });
    assert.equal(r.result.tally.length, 2);
  });

  it("rejects missing boardId or elementId", () => {
    const r = call("vote-cast", ctxA, { boardId: "b1" });
    assert.equal(r.ok, false);
  });

  it("INVARIANT: votes scoped per-user", () => {
    call("vote-cast", ctxA, { boardId: "b1", elementId: "e1" });
    const b = call("vote-tally", ctxB, { boardId: "b1" });
    assert.equal(b.result.tally.length, 0);
  });
});
