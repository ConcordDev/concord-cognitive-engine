// Tier-2 contract tests for board lens parity macros (Trello feature gap).
// Pins comments/attachments/activity, calendar view, card covers,
// automation rules, label management, collaborators, custom fields.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBoardActions from "../domains/board.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`board.${name}`);
  if (!fn) throw new Error(`board.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerBoardActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

/** Create a board + one card for a context, return { board, card }. */
function seedBoardWithCard(ctx) {
  const board = call("board-create", ctx, { name: "Project X" }).result.board;
  const card = call("card-create", ctx, {
    boardId: board.id,
    columnId: board.columns[0].id,
    title: "Build feature",
  }).result.card;
  return { board, card };
}

describe("board — card comments", () => {
  it("adds and lists a comment authored by the actor", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    const r = call("card-comment-add", ctxA, { boardId: board.id, cardId: card.id, text: "Looks good" });
    assert.equal(r.ok, true);
    assert.equal(r.result.comment.text, "Looks good");
    assert.equal(r.result.comment.author, "user_a");
    assert.equal(r.result.commentCount, 1);
  });

  it("rejects an empty comment", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    const r = call("card-comment-add", ctxA, { boardId: board.id, cardId: card.id, text: "  " });
    assert.equal(r.ok, false);
    assert.match(r.error, /required/);
  });

  it("deletes a comment by id", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    const c = call("card-comment-add", ctxA, { boardId: board.id, cardId: card.id, text: "x" }).result.comment;
    const r = call("card-comment-delete", ctxA, { boardId: board.id, cardId: card.id, commentId: c.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.commentCount, 0);
  });
});

describe("board — card attachments", () => {
  it("adds a link attachment", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    const r = call("card-attachment-add", ctxA, {
      boardId: board.id, cardId: card.id, url: "https://example.com/spec.pdf", name: "Spec",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.attachment.name, "Spec");
    assert.equal(r.result.attachmentCount, 1);
  });

  it("rejects an attachment without url", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    const r = call("card-attachment-add", ctxA, { boardId: board.id, cardId: card.id });
    assert.equal(r.ok, false);
  });

  it("deletes an attachment by id", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    const a = call("card-attachment-add", ctxA, {
      boardId: board.id, cardId: card.id, url: "https://x.io",
    }).result.attachment;
    const r = call("card-attachment-delete", ctxA, { boardId: board.id, cardId: card.id, attachmentId: a.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.attachmentCount, 0);
  });
});

describe("board — card detail + activity feed", () => {
  it("card-detail returns comments, attachments, activity", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    call("card-comment-add", ctxA, { boardId: board.id, cardId: card.id, text: "hi" });
    call("card-attachment-add", ctxA, { boardId: board.id, cardId: card.id, url: "https://x.io" });
    const r = call("card-detail", ctxA, { boardId: board.id, cardId: card.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.card.comments.length, 1);
    assert.equal(r.result.card.attachments.length, 1);
    assert.ok(r.result.card.activity.length >= 2);
  });

  it("card-detail errors on unknown card", () => {
    const { board } = seedBoardWithCard(ctxA);
    const r = call("card-detail", ctxA, { boardId: board.id, cardId: "crd_nope" });
    assert.equal(r.ok, false);
    assert.match(r.error, /card not found/);
  });
});

describe("board — calendar view", () => {
  it("groups cards by due date and counts overdue", () => {
    const board = call("board-create", ctxA, { name: "Cal" }).result.board;
    const col = board.columns[0].id;
    call("card-create", ctxA, { boardId: board.id, columnId: col, title: "Past", dueDate: "2020-01-01" });
    call("card-create", ctxA, { boardId: board.id, columnId: col, title: "Future", dueDate: "2099-01-01" });
    call("card-create", ctxA, { boardId: board.id, columnId: col, title: "No date" });
    const r = call("card-calendar", ctxA, { boardId: board.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.scheduled, 2);
    assert.equal(r.result.overdue, 1);
    assert.equal(r.result.unscheduled, 1);
    assert.equal(r.result.days.length, 2);
  });
});

describe("board — card cover", () => {
  it("sets and clears an image cover", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    const set = call("card-set-cover", ctxA, {
      boardId: board.id, cardId: card.id, cover: "https://img.example.com/c.jpg",
    });
    assert.equal(set.ok, true);
    assert.equal(set.result.cover.type, "image");
    const clear = call("card-set-cover", ctxA, { boardId: board.id, cardId: card.id, cover: "" });
    assert.equal(clear.result.cover, null);
  });

  it("accepts a color cover object", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    const r = call("card-set-cover", ctxA, {
      boardId: board.id, cardId: card.id, cover: { type: "color", value: "blue" },
    });
    assert.equal(r.result.cover.type, "color");
    assert.equal(r.result.cover.value, "blue");
  });
});

describe("board — automation rules", () => {
  it("adds and lists a rule, rejects unknown trigger/action", () => {
    const { board } = seedBoardWithCard(ctxA);
    const ok = call("automation-add", ctxA, {
      boardId: board.id, trigger: "card-moved-to-column",
      columnId: board.columns[2].id, action: "check-all-checklist",
    });
    assert.equal(ok.ok, true);
    assert.equal(call("automation-list", ctxA, { boardId: board.id }).result.rules.length, 1);
    const badTrig = call("automation-add", ctxA, {
      boardId: board.id, trigger: "bogus", columnId: board.columns[0].id, action: "clear-due",
    });
    assert.equal(badTrig.ok, false);
    const badAct = call("automation-add", ctxA, {
      boardId: board.id, trigger: "card-moved-to-column", columnId: board.columns[0].id, action: "nuke",
    });
    assert.equal(badAct.ok, false);
  });

  it("card-move-auto checks all checklist items when rule fires", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    call("card-update", ctxA, { boardId: board.id, cardId: card.id, addChecklistItem: "step 1" });
    call("card-update", ctxA, { boardId: board.id, cardId: card.id, addChecklistItem: "step 2" });
    const doneCol = board.columns[2].id;
    call("automation-add", ctxA, {
      boardId: board.id, trigger: "card-moved-to-column", columnId: doneCol, action: "check-all-checklist",
    });
    const r = call("card-move-auto", ctxA, { boardId: board.id, cardId: card.id, toColumnId: doneCol });
    assert.equal(r.ok, true);
    assert.equal(r.result.automationsApplied.length, 1);
    const detail = call("card-detail", ctxA, { boardId: board.id, cardId: card.id }).result.card;
    assert.ok(detail.checklist.every((i) => i.done));
  });

  it("card-move-auto add-label rule appends the label", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    const col = board.columns[1].id;
    call("automation-add", ctxA, {
      boardId: board.id, trigger: "card-moved-to-column", columnId: col,
      action: "add-label", value: "urgent",
    });
    call("card-move-auto", ctxA, { boardId: board.id, cardId: card.id, toColumnId: col });
    const detail = call("card-detail", ctxA, { boardId: board.id, cardId: card.id }).result.card;
    assert.ok(detail.labels.includes("urgent"));
  });

  it("deletes a rule by id", () => {
    const { board } = seedBoardWithCard(ctxA);
    const rule = call("automation-add", ctxA, {
      boardId: board.id, trigger: "card-moved-to-column",
      columnId: board.columns[0].id, action: "clear-due",
    }).result.rule;
    const r = call("automation-delete", ctxA, { boardId: board.id, ruleId: rule.id });
    assert.equal(r.ok, true);
    assert.equal(call("automation-list", ctxA, { boardId: board.id }).result.rules.length, 0);
  });
});

describe("board — label management", () => {
  it("creates, lists and rejects duplicate labels", () => {
    const { board } = seedBoardWithCard(ctxA);
    const a = call("label-create", ctxA, { boardId: board.id, name: "Bug", color: "red" });
    assert.equal(a.ok, true);
    assert.equal(a.result.label.color, "red");
    const dup = call("label-create", ctxA, { boardId: board.id, name: "bug" });
    assert.equal(dup.ok, false);
    assert.equal(call("label-list", ctxA, { boardId: board.id }).result.labels.length, 1);
  });

  it("deletes a label and strips it from cards", () => {
    const board = call("board-create", ctxA, { name: "L" }).result.board;
    const lbl = call("label-create", ctxA, { boardId: board.id, name: "WIP" }).result.label;
    const card = call("card-create", ctxA, {
      boardId: board.id, columnId: board.columns[0].id, title: "T", labels: ["WIP"],
    }).result.card;
    const r = call("label-delete", ctxA, { boardId: board.id, labelId: lbl.id });
    assert.equal(r.ok, true);
    const detail = call("card-detail", ctxA, { boardId: board.id, cardId: card.id }).result.card;
    assert.equal(detail.labels.includes("WIP"), false);
  });
});

describe("board — collaborators / sharing", () => {
  it("adds a collaborator with a role and lists owner + collaborators", () => {
    const { board } = seedBoardWithCard(ctxA);
    const r = call("collaborator-add", ctxA, { boardId: board.id, userId: "user_b", role: "editor" });
    assert.equal(r.ok, true);
    assert.equal(r.result.collaborator.role, "editor");
    const list = call("collaborator-list", ctxA, { boardId: board.id });
    assert.equal(list.result.owner, "user_a");
    assert.equal(list.result.collaborators.length, 1);
  });

  it("re-adding an existing collaborator updates the role", () => {
    const { board } = seedBoardWithCard(ctxA);
    call("collaborator-add", ctxA, { boardId: board.id, userId: "user_b", role: "viewer" });
    const r = call("collaborator-add", ctxA, { boardId: board.id, userId: "user_b", role: "admin" });
    assert.equal(r.result.updated, true);
    assert.equal(r.result.collaborator.role, "admin");
  });

  it("removes a collaborator", () => {
    const { board } = seedBoardWithCard(ctxA);
    call("collaborator-add", ctxA, { boardId: board.id, userId: "user_b" });
    const r = call("collaborator-remove", ctxA, { boardId: board.id, userId: "user_b" });
    assert.equal(r.ok, true);
    assert.equal(call("collaborator-list", ctxA, { boardId: board.id }).result.collaborators.length, 0);
  });
});

describe("board — custom fields / power-ups", () => {
  it("adds a custom field and rejects duplicates", () => {
    const { board } = seedBoardWithCard(ctxA);
    const r = call("custom-field-add", ctxA, { boardId: board.id, name: "Story Points", type: "number" });
    assert.equal(r.ok, true);
    assert.equal(r.result.field.type, "number");
    const dup = call("custom-field-add", ctxA, { boardId: board.id, name: "story points" });
    assert.equal(dup.ok, false);
  });

  it("sets a number field value on a card", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    const field = call("custom-field-add", ctxA, {
      boardId: board.id, name: "Points", type: "number",
    }).result.field;
    const r = call("card-set-field", ctxA, {
      boardId: board.id, cardId: card.id, fieldId: field.id, value: "8",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.customFields[field.id], 8);
    const bad = call("card-set-field", ctxA, {
      boardId: board.id, cardId: card.id, fieldId: field.id, value: "notanumber",
    });
    assert.equal(bad.ok, false);
  });

  it("select field enforces options", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    const field = call("custom-field-add", ctxA, {
      boardId: board.id, name: "Tier", type: "select", options: ["A", "B"],
    }).result.field;
    assert.equal(call("card-set-field", ctxA, {
      boardId: board.id, cardId: card.id, fieldId: field.id, value: "A",
    }).ok, true);
    assert.equal(call("card-set-field", ctxA, {
      boardId: board.id, cardId: card.id, fieldId: field.id, value: "Z",
    }).ok, false);
  });

  it("deletes a custom field and strips it from cards", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    const field = call("custom-field-add", ctxA, {
      boardId: board.id, name: "Notes", type: "text",
    }).result.field;
    call("card-set-field", ctxA, { boardId: board.id, cardId: card.id, fieldId: field.id, value: "hello" });
    const r = call("custom-field-delete", ctxA, { boardId: board.id, fieldId: field.id });
    assert.equal(r.ok, true);
    const detail = call("card-detail", ctxA, { boardId: board.id, cardId: card.id }).result.card;
    assert.equal(detail.customFields[field.id], undefined);
  });
});

describe("board — automation clear-due + set-assignee", () => {
  it("card-move-auto clear-due rule wipes the due date", () => {
    const board = call("board-create", ctxA, { name: "AutoClear" }).result.board;
    const card = call("card-create", ctxA, {
      boardId: board.id, columnId: board.columns[0].id, title: "Has due", dueDate: "2099-01-01",
    }).result.card;
    const doneCol = board.columns[2].id;
    call("automation-add", ctxA, {
      boardId: board.id, trigger: "card-moved-to-column", columnId: doneCol, action: "clear-due",
    });
    call("card-move-auto", ctxA, { boardId: board.id, cardId: card.id, toColumnId: doneCol });
    const detail = call("card-detail", ctxA, { boardId: board.id, cardId: card.id }).result.card;
    assert.equal(detail.dueDate, null);
  });

  it("card-move-auto set-assignee rule assigns the card", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    const col = board.columns[1].id;
    call("automation-add", ctxA, {
      boardId: board.id, trigger: "card-moved-to-column", columnId: col,
      action: "set-assignee", value: "Maya",
    });
    call("card-move-auto", ctxA, { boardId: board.id, cardId: card.id, toColumnId: col });
    const detail = call("card-detail", ctxA, { boardId: board.id, cardId: card.id }).result.card;
    assert.equal(detail.assignee, "Maya");
  });
});

describe("board — calendar surfaces labels + checkbox custom field", () => {
  it("calendar entries carry the card's labels", () => {
    const board = call("board-create", ctxA, { name: "CalLbl" }).result.board;
    call("card-create", ctxA, {
      boardId: board.id, columnId: board.columns[0].id, title: "Tagged",
      dueDate: "2099-06-01", labels: ["urgent"],
    });
    const r = call("card-calendar", ctxA, { boardId: board.id });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.days[0].cards[0].labels, ["urgent"]);
  });

  it("checkbox custom field stores a boolean", () => {
    const { board, card } = seedBoardWithCard(ctxA);
    const field = call("custom-field-add", ctxA, {
      boardId: board.id, name: "Blocked", type: "checkbox",
    }).result.field;
    const r = call("card-set-field", ctxA, {
      boardId: board.id, cardId: card.id, fieldId: field.id, value: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.customFields[field.id], true);
  });
});

describe("board — automation rejects unknown trigger column", () => {
  it("rejects an automation rule for a column not on the board", () => {
    const { board } = seedBoardWithCard(ctxA);
    const r = call("automation-add", ctxA, {
      boardId: board.id, trigger: "card-moved-to-column",
      columnId: "col_nope", action: "clear-due",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /column not found/);
  });
});

describe("board — per-user scoping + STATE guard", () => {
  it("INVARIANT: boards are scoped per-user", () => {
    seedBoardWithCard(ctxA);
    const b = call("board-list", ctxB, {});
    assert.equal(b.result.count, 0);
  });

  it("returns error shape when STATE is missing", () => {
    globalThis._concordSTATE = undefined;
    const r = call("board-list", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});
