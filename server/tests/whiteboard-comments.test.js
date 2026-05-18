// server/tests/whiteboard-comments.test.js
//
// Tier-2 contract tests for Whiteboard Sprint A #5 — comments / threads
// / reactions. Real migration 208, real INSERT/SELECT/UPDATE, real
// role enforcement.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerWhiteboardCommentMacros from "../domains/whiteboard-comments.js";
import { upsertBoard, inviteParticipant } from "../lib/whiteboard/persistence.js";

let db; let boardId; const macros = new Map();

before(async () => {
  db = new Database(":memory:");
  const mig = await import("../migrations/208_whiteboard_persistence.js");
  mig.up(db);
  registerWhiteboardCommentMacros((_d, n, h) => macros.set(n, h));
  const r = upsertBoard(db, { ownerId: "u_owner", title: "Board" });
  boardId = r.id;
  inviteParticipant(db, { boardId, userId: "u_editor", role: "editor" });
  inviteParticipant(db, { boardId, userId: "u_commenter", role: "commenter" });
  inviteParticipant(db, { boardId, userId: "u_viewer", role: "viewer" });
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("whiteboard-comments: add", () => {
  it("rejects no-auth", async () => {
    const r = await macros.get("comment_add")({ db }, { boardId, body: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "auth_required");
  });

  it("rejects missing body", async () => {
    const r = await macros.get("comment_add")({ db, actor: { userId: "u_owner" } }, { boardId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "boardId_and_body_required");
  });

  it("owner can add a comment", async () => {
    const r = await macros.get("comment_add")({ db, actor: { userId: "u_owner" } }, { boardId, body: "first!" });
    assert.equal(r.ok, true);
    assert.ok(r.id.startsWith("wb_cmt:"));
    assert.equal(r.threadId, r.id);
  });

  it("commenter can add a comment", async () => {
    const r = await macros.get("comment_add")({ db, actor: { userId: "u_commenter" } }, { boardId, body: "hi", elementId: "e1" });
    assert.equal(r.ok, true);
    assert.equal(r.elementId, "e1");
  });

  it("non-participant is forbidden", async () => {
    const r = await macros.get("comment_add")({ db, actor: { userId: "u_outsider" } }, { boardId, body: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });

  it("threadId carries through for replies", async () => {
    const root = await macros.get("comment_add")({ db, actor: { userId: "u_owner" } }, { boardId, body: "root" });
    const reply = await macros.get("comment_add")({ db, actor: { userId: "u_editor" } }, { boardId, body: "reply", threadId: root.id });
    assert.equal(reply.threadId, root.id);
  });
});

describe("whiteboard-comments: list / resolve / react", () => {
  it("viewer can list comments", async () => {
    const r = await macros.get("comment_list")({ db, actor: { userId: "u_viewer" } }, { boardId });
    assert.equal(r.ok, true);
    assert.ok(r.count >= 3);
  });

  it("non-participant cannot list comments", async () => {
    const r = await macros.get("comment_list")({ db, actor: { userId: "u_outsider" } }, { boardId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });

  it("editor can resolve a comment", async () => {
    const add = await macros.get("comment_add")({ db, actor: { userId: "u_owner" } }, { boardId, body: "to resolve" });
    const r = await macros.get("comment_resolve")({ db, actor: { userId: "u_editor" } }, { id: add.id });
    assert.equal(r.ok, true);
    assert.equal(r.resolvedBy, "u_editor");
  });

  it("commenter cannot resolve (editor+ only)", async () => {
    const add = await macros.get("comment_add")({ db, actor: { userId: "u_owner" } }, { boardId, body: "x" });
    const r = await macros.get("comment_resolve")({ db, actor: { userId: "u_commenter" } }, { id: add.id });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });

  it("viewer can react with emoji (toggle on/off)", async () => {
    const add = await macros.get("comment_add")({ db, actor: { userId: "u_owner" } }, { boardId, body: "reactable" });
    const on = await macros.get("comment_react")({ db, actor: { userId: "u_viewer" } }, { id: add.id, emoji: "🚀" });
    assert.equal(on.ok, true);
    assert.equal(on.action, "added");
    assert.equal(on.totalForEmoji, 1);
    const off = await macros.get("comment_react")({ db, actor: { userId: "u_viewer" } }, { id: add.id, emoji: "🚀" });
    assert.equal(off.action, "removed");
    assert.equal(off.totalForEmoji, 0);
  });

  it("comment_list returns the reactions object", async () => {
    const add = await macros.get("comment_add")({ db, actor: { userId: "u_owner" } }, { boardId, body: "with react" });
    await macros.get("comment_react")({ db, actor: { userId: "u_editor" } }, { id: add.id, emoji: "❤️" });
    const list = await macros.get("comment_list")({ db, actor: { userId: "u_viewer" } }, { boardId });
    const row = list.comments.find((c) => c.id === add.id);
    assert.ok(row);
    assert.equal(row.reactions["❤️"].length, 1);
  });

  it("onlyUnresolved filter excludes resolved comments", async () => {
    const r = await macros.get("comment_list")({ db, actor: { userId: "u_viewer" } }, { boardId, onlyUnresolved: true });
    assert.equal(r.ok, true);
    assert.ok(r.comments.every((c) => !c.resolved));
  });
});
