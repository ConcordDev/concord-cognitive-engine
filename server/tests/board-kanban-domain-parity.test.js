// Contract tests for the board lens — Trello / Asana-shape kanban
// substrate in server/domains/board.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBoardActions from "../domains/board.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`board.${name}`);
  assert.ok(fn, `board.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerBoardActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newBoard(ctx = ctxA) {
  return call("board-create", ctx, { name: "Sprint 1" }).result.board;
}

describe("board.board CRUD", () => {
  it("creates a board with 3 default columns, scoped per user", () => {
    const b = newBoard();
    assert.equal(b.columns.length, 3);
    assert.equal(b.columns[0].name, "To Do");
    assert.equal(call("board-list", ctxA, {}).result.count, 1);
    assert.equal(call("board-list", ctxB, {}).result.count, 0);
  });
  it("rejects an unnamed board and deletes one", () => {
    assert.equal(call("board-create", ctxA, {}).ok, false);
    const b = newBoard();
    call("board-delete", ctxA, { id: b.id });
    assert.equal(call("board-list", ctxA, {}).result.count, 0);
  });
});

describe("board.columns", () => {
  it("adds and deletes a column (cascading its cards)", () => {
    const b = newBoard();
    const col = call("column-add", ctxA, { boardId: b.id, name: "Review" }).result.column;
    call("card-create", ctxA, { boardId: b.id, columnId: col.id, title: "Card in Review" });
    call("column-delete", ctxA, { boardId: b.id, columnId: col.id });
    const detail = call("board-detail", ctxA, { id: b.id }).result.board;
    assert.equal(detail.columns.length, 3);
    assert.equal(detail.cards.length, 0);
  });
});

describe("board.cards", () => {
  it("creates a card in a column", () => {
    const b = newBoard();
    const c = call("card-create", ctxA, { boardId: b.id, columnId: b.columns[0].id, title: "Build feature" });
    assert.equal(c.ok, true);
    assert.equal(c.result.card.columnId, b.columns[0].id);
  });
  it("rejects a titleless card", () => {
    const b = newBoard();
    assert.equal(call("card-create", ctxA, { boardId: b.id, columnId: b.columns[0].id }).ok, false);
  });
  it("moves a card to another column", () => {
    const b = newBoard();
    const c = call("card-create", ctxA, { boardId: b.id, columnId: b.columns[0].id, title: "Task" }).result.card;
    call("card-move", ctxA, { boardId: b.id, cardId: c.id, toColumnId: b.columns[2].id });
    const moved = call("board-detail", ctxA, { id: b.id }).result.board.cards[0];
    assert.equal(moved.columnId, b.columns[2].id);
  });
  it("updates a card and toggles a checklist item", () => {
    const b = newBoard();
    const c = call("card-create", ctxA, { boardId: b.id, columnId: b.columns[0].id, title: "Task" }).result.card;
    call("card-update", ctxA, { boardId: b.id, cardId: c.id, labels: ["bug"], addChecklistItem: "write tests" });
    const card = call("board-detail", ctxA, { id: b.id }).result.board.cards[0];
    assert.equal(card.labels[0], "bug");
    assert.equal(card.checklist.length, 1);
    const t = call("card-checklist-toggle", ctxA, { boardId: b.id, cardId: c.id, itemId: card.checklist[0].id });
    assert.equal(t.result.done, true);
  });
  it("deletes a card", () => {
    const b = newBoard();
    const c = call("card-create", ctxA, { boardId: b.id, columnId: b.columns[0].id, title: "Task" }).result.card;
    call("card-delete", ctxA, { boardId: b.id, cardId: c.id });
    assert.equal(call("board-detail", ctxA, { id: b.id }).result.board.cards.length, 0);
  });
});

describe("board.dashboard", () => {
  it("aggregates boards, cards and overdue", () => {
    const b = newBoard();
    const c = call("card-create", ctxA, { boardId: b.id, columnId: b.columns[0].id, title: "Late" }).result.card;
    call("card-update", ctxA, { boardId: b.id, cardId: c.id, dueDate: "2020-01-01" });
    const d = call("board-dashboard", ctxA, {});
    assert.equal(d.result.boards, 1);
    assert.equal(d.result.totalCards, 1);
    assert.equal(d.result.overdue, 1);
  });
});
