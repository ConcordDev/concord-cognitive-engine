// Behaviour tests for the Board rework macros (HANDOFF-LENS-REWORK #1705):
// edit-in-place (board/column/label/comment/custom-field), archive/restore,
// card templates, and the due-reminders read. These close the Trello-parity
// gaps where the board domain was create/delete-only: nothing could be
// renamed, reordered, edited, or archived.
//
// Harness mirrors board-lens-macros.test.js: handlers are invoked directly
// with the exact 3-arg shape the live run route uses, against a fresh
// in-memory STATE per test. No network.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBoardActions from "../domains/board.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "board", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`board.${name} not registered`);
  return fn(ctx, { id: null, domain: "board", type: "domain_action", data: {}, meta: {} }, params);
}

before(() => { registerBoardActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

function makeBoard(ctx = ctxA, name = "Roadmap") {
  const r = call("board-create", ctx, { name });
  assert.equal(r.ok, true);
  return r.result.board;
}
function makeCard(ctx, board, title = "Ship it", extra = {}) {
  const r = call("card-create", ctx, { boardId: board.id, title, ...extra });
  assert.equal(r.ok, true);
  return r.result.card;
}

const NEW_MACROS = [
  "board-update", "column-update", "column-archive", "column-restore",
  "card-archive", "card-restore", "card-comment-update",
  "label-update", "custom-field-update",
  "card-template-create", "card-template-list", "card-template-delete",
  "card-create-from-template", "due-reminders",
];

describe("board rework — registration", () => {
  it("registers every edit/archive/template macro", () => {
    for (const m of NEW_MACROS) assert.ok(ACTIONS.has(m), `board.${m} not registered`);
  });
});

describe("board-update", () => {
  it("renames a board and sets a description", () => {
    const b = makeBoard(ctxA);
    const r = call("board-update", ctxA, { id: b.id, name: "Q4 Roadmap", description: "plans" });
    assert.equal(r.ok, true);
    assert.equal(r.result.board.name, "Q4 Roadmap");
    assert.equal(r.result.board.description, "plans");
  });
  it("rejects an empty name", () => {
    const b = makeBoard(ctxA);
    const r = call("board-update", ctxA, { id: b.id, name: "   " });
    assert.equal(r.ok, false);
    assert.match(r.error, /name required/);
  });
  it("does not reach another user's board", () => {
    const b = makeBoard(ctxA);
    const r = call("board-update", ctxB, { id: b.id, name: "hijack" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });
});

describe("column-update", () => {
  it("renames a column", () => {
    const b = makeBoard(ctxA);
    const col = b.columns[0];
    const r = call("column-update", ctxA, { boardId: b.id, columnId: col.id, name: "Backlog" });
    assert.equal(r.ok, true);
    assert.equal(r.result.column.name, "Backlog");
  });
  it("reorders a column by index", () => {
    const b = makeBoard(ctxA);
    const done = b.columns[2];
    const r = call("column-update", ctxA, { boardId: b.id, columnId: done.id, toIndex: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.result.index, 0);
    const detail = call("board-detail", ctxA, { id: b.id });
    assert.equal(detail.result.board.columns[0].id, done.id);
  });
  it("rejects an empty rename and an unknown column", () => {
    const b = makeBoard(ctxA);
    assert.equal(call("column-update", ctxA, { boardId: b.id, columnId: b.columns[0].id, name: "" }).ok, false);
    assert.equal(call("column-update", ctxA, { boardId: b.id, columnId: "nope", name: "X" }).ok, false);
  });
});

describe("archive / restore", () => {
  it("archives and restores a card, logging both to activity", () => {
    const b = makeBoard(ctxA);
    const card = makeCard(ctxA, b);
    const a = call("card-archive", ctxA, { boardId: b.id, cardId: card.id });
    assert.equal(a.ok, true);
    let detail = call("card-detail", ctxA, { boardId: b.id, cardId: card.id });
    assert.equal(detail.result.card.archived, true);
    const r = call("card-restore", ctxA, { boardId: b.id, cardId: card.id });
    assert.equal(r.ok, true);
    detail = call("card-detail", ctxA, { boardId: b.id, cardId: card.id });
    assert.equal(detail.result.card.archived, false);
    const actions = detail.result.card.activity.map((x) => x.action);
    assert.ok(actions.includes("archived the card"));
    assert.ok(actions.includes("restored the card"));
  });
  it("archives and restores a column without deleting its cards", () => {
    const b = makeBoard(ctxA);
    const card = makeCard(ctxA, b);
    const colId = card.columnId;
    assert.equal(call("column-archive", ctxA, { boardId: b.id, columnId: colId }).ok, true);
    let detail = call("board-detail", ctxA, { id: b.id });
    assert.equal(detail.result.board.columns.find((c) => c.id === colId).archived, true);
    assert.equal(detail.result.board.cards.length, 1);
    assert.equal(call("column-restore", ctxA, { boardId: b.id, columnId: colId }).ok, true);
    detail = call("board-detail", ctxA, { id: b.id });
    assert.equal(detail.result.board.columns.find((c) => c.id === colId).archived, false);
  });
  it("errors on unknown card / column", () => {
    const b = makeBoard(ctxA);
    assert.equal(call("card-archive", ctxA, { boardId: b.id, cardId: "nope" }).ok, false);
    assert.equal(call("column-archive", ctxA, { boardId: b.id, columnId: "nope" }).ok, false);
  });
});

describe("card-comment-update", () => {
  function boardWithComment() {
    const b = makeBoard(ctxA);
    const card = makeCard(ctxA, b);
    const c = call("card-comment-add", ctxA, { boardId: b.id, cardId: card.id, text: "first draft" });
    assert.equal(c.ok, true);
    return { b, card, comment: c.result.comment };
  }
  it("lets the author edit, stamping editedAt", () => {
    const { b, card, comment } = boardWithComment();
    const r = call("card-comment-update", ctxA, { boardId: b.id, cardId: card.id, commentId: comment.id, text: "revised" });
    assert.equal(r.ok, true);
    assert.equal(r.result.comment.text, "revised");
    assert.ok(r.result.comment.editedAt);
  });
  it("rejects a non-author edit", () => {
    const { b, card, comment } = boardWithComment();
    // user_b cannot even see user_a's board (per-user store), so use a second
    // comment authored by ctxB on ctxB's own board to prove the author gate
    // itself: author mismatch on the SAME board requires a shared board,
    // which the per-user store does not have — assert the gate via a forged
    // author field instead: a comment whose author differs from the caller.
    const mine = call("board-create", ctxB, { name: "B board" }).result.board;
    const myCard = makeCard(ctxB, mine);
    const foreign = { id: "cmt_foreign", author: "user_a", text: "not yours", at: new Date().toISOString() };
    myCard.comments = [foreign];
    const r = call("card-comment-update", ctxB, { boardId: mine.id, cardId: myCard.id, commentId: "cmt_foreign", text: "hijack" });
    assert.equal(r.ok, false);
    assert.match(r.error, /only the comment author/);
    assert.equal(comment.text, "first draft");
  });
  it("rejects empty replacement text", () => {
    const { b, card, comment } = boardWithComment();
    const r = call("card-comment-update", ctxA, { boardId: b.id, cardId: card.id, commentId: comment.id, text: "  " });
    assert.equal(r.ok, false);
  });
});

describe("label-update", () => {
  it("renames a label and cascades the new name onto cards", () => {
    const b = makeBoard(ctxA);
    const label = call("label-create", ctxA, { boardId: b.id, name: "bug", color: "red" }).result.label;
    const card = makeCard(ctxA, b, "Fix crash", { labels: ["bug"] });
    const r = call("label-update", ctxA, { boardId: b.id, labelId: label.id, name: "defect", color: "orange" });
    assert.equal(r.ok, true);
    assert.equal(r.result.label.name, "defect");
    assert.equal(r.result.label.color, "orange");
    const detail = call("card-detail", ctxA, { boardId: b.id, cardId: card.id });
    assert.deepEqual(detail.result.card.labels, ["defect"]);
  });
  it("rejects a duplicate name and an unknown color", () => {
    const b = makeBoard(ctxA);
    call("label-create", ctxA, { boardId: b.id, name: "bug", color: "red" });
    const l2 = call("label-create", ctxA, { boardId: b.id, name: "ui", color: "blue" }).result.label;
    assert.equal(call("label-update", ctxA, { boardId: b.id, labelId: l2.id, name: "BUG" }).ok, false);
    assert.equal(call("label-update", ctxA, { boardId: b.id, labelId: l2.id, color: "mauve" }).ok, false);
  });
});

describe("custom-field-update", () => {
  it("renames a field and replaces select options", () => {
    const b = makeBoard(ctxA);
    const f = call("custom-field-add", ctxA, { boardId: b.id, name: "Size", type: "select", options: ["S", "M"] }).result.field;
    const r = call("custom-field-update", ctxA, { boardId: b.id, fieldId: f.id, name: "T-shirt size", options: ["S", "M", "L"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.field.name, "T-shirt size");
    assert.deepEqual(r.result.field.options, ["S", "M", "L"]);
  });
  it("rejects options on a non-select field and duplicate names", () => {
    const b = makeBoard(ctxA);
    const f = call("custom-field-add", ctxA, { boardId: b.id, name: "Notes", type: "text" }).result.field;
    call("custom-field-add", ctxA, { boardId: b.id, name: "Other", type: "text" });
    assert.equal(call("custom-field-update", ctxA, { boardId: b.id, fieldId: f.id, options: ["x"] }).ok, false);
    assert.equal(call("custom-field-update", ctxA, { boardId: b.id, fieldId: f.id, name: "other" }).ok, false);
  });
});

describe("card templates", () => {
  it("saves a card as a template and spawns a fresh card from it", () => {
    const b = makeBoard(ctxA);
    const card = makeCard(ctxA, b, "Weekly report", { description: "fill in", labels: ["ops"] });
    call("card-update", ctxA, { boardId: b.id, cardId: card.id, addChecklistItem: "gather numbers" });
    const t = call("card-template-create", ctxA, { boardId: b.id, cardId: card.id });
    assert.equal(t.ok, true);
    const list = call("card-template-list", ctxA, { boardId: b.id });
    assert.equal(list.result.templates.length, 1);
    const spawned = call("card-create-from-template", ctxA, { boardId: b.id, templateId: t.result.template.id });
    assert.equal(spawned.ok, true);
    assert.equal(spawned.result.card.title, "Weekly report");
    assert.equal(spawned.result.card.checklist.length, 1);
    assert.equal(spawned.result.card.checklist[0].done, false);
    assert.notEqual(spawned.result.card.id, card.id);
    assert.equal(call("card-template-delete", ctxA, { boardId: b.id, templateId: t.result.template.id }).ok, true);
    assert.equal(call("card-create-from-template", ctxA, { boardId: b.id, templateId: t.result.template.id }).ok, false);
  });
});

describe("due-reminders", () => {
  it("reports overdue and due-soon cards, skipping archived and far-future", () => {
    const b = makeBoard(ctxA);
    const past = new Date(Date.now() - 86400000).toISOString();
    const soon = new Date(Date.now() + 3600000).toISOString();
    const far = new Date(Date.now() + 30 * 86400000).toISOString();
    makeCard(ctxA, b, "overdue one", { dueDate: past });
    makeCard(ctxA, b, "soon one", { dueDate: soon });
    makeCard(ctxA, b, "far one", { dueDate: far });
    const arch = makeCard(ctxA, b, "archived overdue", { dueDate: past });
    call("card-archive", ctxA, { boardId: b.id, cardId: arch.id });
    const r = call("due-reminders", ctxA, { withinHours: 48 });
    assert.equal(r.ok, true);
    assert.equal(r.result.overdueCount, 1);
    assert.equal(r.result.dueSoonCount, 1);
    assert.deepEqual(r.result.reminders.map((x) => x.title), ["overdue one", "soon one"]);
  });
});

describe("activity coverage", () => {
  it("records create, move, and update on the card activity feed", () => {
    const b = makeBoard(ctxA);
    const card = makeCard(ctxA, b);
    call("card-move", ctxA, { boardId: b.id, cardId: card.id, toColumnId: b.columns[1].id });
    call("card-update", ctxA, { boardId: b.id, cardId: card.id, description: "details" });
    const detail = call("card-detail", ctxA, { boardId: b.id, cardId: card.id });
    const actions = detail.result.card.activity.map((x) => x.action);
    assert.ok(actions.includes("created the card"));
    assert.ok(actions.includes(`moved to ${b.columns[1].name}`));
    assert.ok(actions.includes("updated the card"));
  });
});
