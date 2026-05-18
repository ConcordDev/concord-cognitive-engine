// server/tests/whiteboard-persistence.test.js
//
// Tier-2 contract tests for Whiteboard Sprint A #1 — DB persistence
// substrate (migration 208). Real SQLite, real round-trip, real role
// gating.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  upsertBoard, getBoard, listBoardsForOwner, listBoardsForParticipant,
  deleteBoard, appendDelta, listDeltas, inviteParticipant,
  revokeParticipant, getRole, hasRole,
} from "../lib/whiteboard/persistence.js";

let db;

before(async () => {
  db = new Database(":memory:");
  const mig = await import("../migrations/208_whiteboard_persistence.js");
  mig.up(db);
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("whiteboard persistence: boards CRUD", () => {
  it("upsertBoard inserts a new board + auto-adds owner as participant", () => {
    const r = upsertBoard(db, { ownerId: "u_alice", title: "First board", scene: { elements: [{ id: "e1", x: 0, y: 0 }] } });
    assert.equal(r.ok, true);
    assert.ok(r.id.startsWith("wb_"));
    const role = getRole(db, r.id, "u_alice");
    assert.equal(role, "owner");
  });

  it("getBoard returns scene-parsed row", () => {
    const r = upsertBoard(db, { ownerId: "u_alice", title: "Has scene", scene: { elements: [{ id: "x", text: "hi" }] } });
    const row = getBoard(db, r.id);
    assert.ok(row);
    assert.equal(row.scene.elements.length, 1);
    assert.equal(row.scene.elements[0].text, "hi");
  });

  it("upsertBoard on conflict updates title + scene", () => {
    const r1 = upsertBoard(db, { ownerId: "u_alice", title: "V1", scene: { elements: [] } });
    const r2 = upsertBoard(db, { id: r1.id, ownerId: "u_alice", title: "V2", scene: { elements: [{ id: "added" }] } });
    assert.equal(r2.ok, true);
    const row = getBoard(db, r1.id);
    assert.equal(row.title, "V2");
    assert.equal(row.scene.elements.length, 1);
  });

  it("listBoardsForOwner returns the owner's boards, kind-filtered", () => {
    upsertBoard(db, { ownerId: "u_bob", title: "Bob private", kind: "private" });
    upsertBoard(db, { ownerId: "u_bob", title: "Bob shared", kind: "shared" });
    const all = listBoardsForOwner(db, "u_bob");
    assert.ok(all.length >= 2);
    const onlyShared = listBoardsForOwner(db, "u_bob", { kind: "shared" });
    assert.ok(onlyShared.every((r) => r.kind === "shared"));
  });

  it("deleteBoard cascades to deltas and participants", () => {
    const r = upsertBoard(db, { ownerId: "u_carol", title: "To delete" });
    appendDelta(db, { boardId: r.id, userId: "u_carol", deltaKind: "element_add", delta: { id: "x" } });
    const d = deleteBoard(db, r.id, "u_carol");
    assert.equal(d.deleted, 1);
    assert.equal(getBoard(db, r.id), null);
    const ds = listDeltas(db, { boardId: r.id });
    assert.equal(ds.length, 0);
  });

  it("deleteBoard refuses non-owner", () => {
    const r = upsertBoard(db, { ownerId: "u_alice", title: "Owned by alice" });
    const d = deleteBoard(db, r.id, "u_bob");
    assert.equal(d.deleted, 0);
    assert.ok(getBoard(db, r.id));
  });
});

describe("whiteboard persistence: deltas + time travel", () => {
  let boardId;
  before(() => {
    const r = upsertBoard(db, { ownerId: "u_dev", title: "Delta board", scene: { elements: [] } });
    boardId = r.id;
  });

  it("appendDelta records element changes", () => {
    appendDelta(db, { boardId, userId: "u_dev", deltaKind: "element_add", delta: { id: "rect1", kind: "rectangle" } });
    appendDelta(db, { boardId, userId: "u_dev", deltaKind: "element_update", delta: { id: "rect1", x: 100 } });
    const ds = listDeltas(db, { boardId });
    assert.equal(ds.length, 2);
    assert.equal(ds[0].delta_kind, "element_add");
  });

  it("scene_replace delta updates the board's snapshot in one go", () => {
    appendDelta(db, {
      boardId, userId: "u_dev", deltaKind: "scene_replace",
      delta: { reason: "explicit_save" }, newScene: { elements: [{ id: "snapshotted" }] },
    });
    const row = getBoard(db, boardId);
    assert.equal(row.scene.elements.length, 1);
    assert.equal(row.scene.elements[0].id, "snapshotted");
  });

  it("listDeltas paginates by since/server_ts", () => {
    const all = listDeltas(db, { boardId });
    const halfTs = all[Math.floor(all.length / 2)].server_ts;
    const later = listDeltas(db, { boardId, since: halfTs });
    assert.ok(later.length < all.length);
  });
});

describe("whiteboard persistence: participants + roles", () => {
  let boardId;
  before(() => {
    const r = upsertBoard(db, { ownerId: "u_owner", title: "Roles board" });
    boardId = r.id;
  });

  it("invite + role + hasRole work end-to-end", () => {
    inviteParticipant(db, { boardId, userId: "u_editor", role: "editor", invitedBy: "u_owner" });
    inviteParticipant(db, { boardId, userId: "u_commenter", role: "commenter", invitedBy: "u_owner" });
    inviteParticipant(db, { boardId, userId: "u_viewer", role: "viewer", invitedBy: "u_owner" });
    assert.equal(getRole(db, boardId, "u_editor"), "editor");
    assert.ok(hasRole(db, boardId, "u_editor", "commenter"));      // editor >= commenter
    assert.ok(!hasRole(db, boardId, "u_viewer", "editor"));        // viewer < editor
    assert.ok(hasRole(db, boardId, "u_owner", "owner"));
  });

  it("invite rejects unknown role", () => {
    const r = inviteParticipant(db, { boardId, userId: "u_x", role: "godmode" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_role");
  });

  it("invite is idempotent — re-invite changes role", () => {
    inviteParticipant(db, { boardId, userId: "u_editor", role: "viewer" });
    assert.equal(getRole(db, boardId, "u_editor"), "viewer");
  });

  it("revoke deletes participant (but never the owner)", () => {
    revokeParticipant(db, { boardId, userId: "u_viewer" });
    assert.equal(getRole(db, boardId, "u_viewer"), null);
    const ownerRevoke = revokeParticipant(db, { boardId, userId: "u_owner" });
    assert.equal(ownerRevoke.revoked, 0);
    assert.equal(getRole(db, boardId, "u_owner"), "owner");
  });

  it("listBoardsForParticipant returns boards the user can see", () => {
    inviteParticipant(db, { boardId, userId: "u_friend", role: "editor" });
    const boards = listBoardsForParticipant(db, "u_friend");
    assert.ok(boards.find((b) => b.id === boardId));
  });
});
