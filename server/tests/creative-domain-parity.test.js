// Contract tests for the creative Milanote 2026-parity visual board
// tool (boards, positioned cards, connections, templates).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCreativeActions from "../domains/creative.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`creative.${name}`);
  assert.ok(fn, `creative.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerCreativeActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newBoard(ctx = ctxA) {
  const r = call("board-create", ctx, { title: "Campaign ideas" });
  assert.equal(r.ok, true);
  return r.result.board.id;
}

describe("creative.board-*", () => {
  it("creates, lists with card counts, renames and deletes", () => {
    const bid = newBoard();
    call("card-add", ctxA, { boardId: bid, type: "note", content: "Idea" });
    const list = call("board-list", ctxA, {});
    assert.equal(list.result.boards[0].cardCount, 1);
    call("board-rename", ctxA, { id: bid, title: "Final ideas" });
    assert.equal(call("board-get", ctxA, { id: bid }).result.board.title, "Final ideas");
    call("board-delete", ctxA, { id: bid });
    assert.equal(call("board-list", ctxA, {}).result.count, 0);
  });

  it("isolates boards per user", () => {
    newBoard(ctxA);
    assert.equal(call("board-list", ctxB, {}).result.count, 0);
  });

  it("duplicates a board with its cards and connections", () => {
    const bid = newBoard();
    const c1 = call("card-add", ctxA, { boardId: bid, type: "note", content: "A" }).result.card;
    const c2 = call("card-add", ctxA, { boardId: bid, type: "note", content: "B" }).result.card;
    call("connection-add", ctxA, { fromCardId: c1.id, toCardId: c2.id });
    const dup = call("board-duplicate", ctxA, { id: bid }).result.board;
    const got = call("board-get", ctxA, { id: dup.id });
    assert.equal(got.result.cards.length, 2);
    assert.equal(got.result.connections.length, 1);
  });
});

describe("creative cards", () => {
  it("adds cards with a type and increasing z-order", () => {
    const bid = newBoard();
    const c1 = call("card-add", ctxA, { boardId: bid, type: "task", content: "Do this" }).result.card;
    const c2 = call("card-add", ctxA, { boardId: bid, type: "note", content: "Note" }).result.card;
    assert.ok(c2.z > c1.z);
  });

  it("updates content, moves and toggles done", () => {
    const bid = newBoard();
    const c = call("card-add", ctxA, { boardId: bid, type: "task", content: "x" }).result.card;
    call("card-update", ctxA, { cardId: c.id, content: "updated", done: true });
    call("card-move", ctxA, { cardId: c.id, x: 400, y: 300 });
    const got = call("board-get", ctxA, { id: bid }).result.cards[0];
    assert.equal(got.content, "updated");
    assert.equal(got.done, true);
    assert.equal(got.x, 400);
  });

  it("card-raise bumps a card to the top", () => {
    const bid = newBoard();
    const c1 = call("card-add", ctxA, { boardId: bid, type: "note", content: "A" }).result.card;
    const c2 = call("card-add", ctxA, { boardId: bid, type: "note", content: "B" }).result.card;
    const r = call("card-raise", ctxA, { cardId: c1.id });
    assert.ok(r.result.z > c2.z);
  });

  it("deletes a card and its connections", () => {
    const bid = newBoard();
    const c1 = call("card-add", ctxA, { boardId: bid, type: "note", content: "A" }).result.card;
    const c2 = call("card-add", ctxA, { boardId: bid, type: "note", content: "B" }).result.card;
    call("connection-add", ctxA, { fromCardId: c1.id, toCardId: c2.id });
    call("card-delete", ctxA, { cardId: c1.id });
    const got = call("board-get", ctxA, { id: bid });
    assert.equal(got.result.cards.length, 1);
    assert.equal(got.result.connections.length, 0);
  });
});

describe("creative connections", () => {
  it("connects two cards and rejects bad connections", () => {
    const bid = newBoard();
    const c1 = call("card-add", ctxA, { boardId: bid, type: "note", content: "A" }).result.card;
    const c2 = call("card-add", ctxA, { boardId: bid, type: "note", content: "B" }).result.card;
    assert.equal(call("connection-add", ctxA, { fromCardId: c1.id, toCardId: c1.id }).ok, false);
    const conn = call("connection-add", ctxA, { fromCardId: c1.id, toCardId: c2.id }).result.connection;
    assert.equal(call("connection-add", ctxA, { fromCardId: c1.id, toCardId: c2.id }).ok, false);
    call("connection-delete", ctxA, { id: conn.id });
    assert.equal(call("board-get", ctxA, { id: bid }).result.connections.length, 0);
  });
});

describe("creative templates & dashboard", () => {
  it("lists templates and seeds a board from one", () => {
    assert.ok(call("board-templates", ctxA, {}).result.templates.length >= 4);
    const r = call("board-from-template", ctxA, { templateId: "story-outline", title: "My Story" });
    assert.ok(r.result.cardsSeeded > 0);
    const got = call("board-get", ctxA, { id: r.result.board.id });
    assert.equal(got.result.cards.length, r.result.cardsSeeded);
  });

  it("rejects an unknown template", () => {
    assert.equal(call("board-from-template", ctxA, { templateId: "nope" }).ok, false);
  });

  it("dashboard counts boards, cards and tasks", () => {
    const bid = newBoard();
    call("card-add", ctxA, { boardId: bid, type: "task", content: "open" });
    const done = call("card-add", ctxA, { boardId: bid, type: "task", content: "done" }).result.card;
    call("card-update", ctxA, { cardId: done.id, done: true });
    const d = call("creative-dashboard", ctxA, {});
    assert.equal(d.result.boards, 1);
    assert.equal(d.result.openTasks, 1);
    assert.equal(d.result.doneTasks, 1);
  });
});
