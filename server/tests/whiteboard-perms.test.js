// server/tests/whiteboard-perms.test.js
//
// Tier-2 contract tests for Whiteboard Sprint B Item #12 — permissions.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerWhiteboardPermsMacros from "../domains/whiteboard-perms.js";
import { upsertBoard, inviteParticipant, getRole } from "../lib/whiteboard/persistence.js";

let db; let boardId; const macros = new Map();

before(async () => {
  db = new Database(":memory:");
  const mig = await import("../migrations/208_whiteboard_persistence.js");
  mig.up(db);
  registerWhiteboardPermsMacros((_d, n, h) => macros.set(n, h));
  const r = upsertBoard(db, { ownerId: "u_owner", title: "Perms board" });
  boardId = r.id;
  inviteParticipant(db, { boardId, userId: "u_admin", role: "admin" });
  inviteParticipant(db, { boardId, userId: "u_editor", role: "editor" });
  inviteParticipant(db, { boardId, userId: "u_viewer", role: "viewer" });
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("whiteboard-perms: list", () => {
  it("viewer can list participants + see own role", async () => {
    const r = await macros.get("perms_list")({ db, actor: { userId: "u_viewer" } }, { boardId });
    assert.equal(r.ok, true);
    assert.ok(r.participants.length >= 4);
    assert.equal(r.myRole, "viewer");
  });

  it("non-participant forbidden", async () => {
    const r = await macros.get("perms_list")({ db, actor: { userId: "u_outsider" } }, { boardId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });
});

describe("whiteboard-perms: invite", () => {
  it("admin can invite a new user", async () => {
    const r = await macros.get("perms_invite")({ db, actor: { userId: "u_admin" } }, {
      boardId, userId: "u_new", role: "editor",
    });
    assert.equal(r.ok, true);
    assert.equal(getRole(db, boardId, "u_new"), "editor");
  });

  it("editor cannot invite (admin+ required)", async () => {
    const r = await macros.get("perms_invite")({ db, actor: { userId: "u_editor" } }, {
      boardId, userId: "u_x", role: "editor",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });
});

describe("whiteboard-perms: update_role", () => {
  it("admin promotes editor to admin", async () => {
    const r = await macros.get("perms_update_role")({ db, actor: { userId: "u_admin" } }, {
      boardId, userId: "u_editor", role: "admin",
    });
    assert.equal(r.ok, true);
    assert.equal(getRole(db, boardId, "u_editor"), "admin");
  });

  it("admin cannot promote anyone to owner", async () => {
    const r = await macros.get("perms_update_role")({ db, actor: { userId: "u_admin" } }, {
      boardId, userId: "u_viewer", role: "owner",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "use_perms_transfer_owner");
  });

  it("admin cannot demote the owner", async () => {
    const r = await macros.get("perms_update_role")({ db, actor: { userId: "u_admin" } }, {
      boardId, userId: "u_owner", role: "viewer",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "cannot_demote_owner");
  });
});

describe("whiteboard-perms: revoke", () => {
  it("admin can revoke a participant", async () => {
    const r = await macros.get("perms_revoke")({ db, actor: { userId: "u_admin" } }, {
      boardId, userId: "u_viewer",
    });
    assert.equal(r.ok, true);
    assert.equal(getRole(db, boardId, "u_viewer"), null);
  });

  it("self-revoke is allowed", async () => {
    const r = await macros.get("perms_revoke")({ db, actor: { userId: "u_new" } }, {
      boardId, userId: "u_new",
    });
    assert.equal(r.ok, true);
    assert.equal(getRole(db, boardId, "u_new"), null);
  });

  it("owner is never revocable", async () => {
    const r = await macros.get("perms_revoke")({ db, actor: { userId: "u_admin" } }, {
      boardId, userId: "u_owner",
    });
    // hasRole(admin) is true so we attempt; persistence revokeParticipant guards owner.
    assert.equal(r.ok, true);
    assert.equal(r.revoked, 0); // 0 rows deleted because of the `role != 'owner'` filter
    assert.equal(getRole(db, boardId, "u_owner"), "owner");
  });
});
