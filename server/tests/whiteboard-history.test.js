// server/tests/whiteboard-history.test.js
//
// Tier-2 contract test for Whiteboard Sprint B Item #11 — version
// history / time travel. Real migration 208, real delta replay.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerWhiteboardHistoryMacros from "../domains/whiteboard-history.js";
import { upsertBoard, inviteParticipant, appendDelta, getBoard } from "../lib/whiteboard/persistence.js";

let db; let boardId; const macros = new Map();

before(async () => {
  db = new Database(":memory:");
  const mig = await import("../migrations/208_whiteboard_persistence.js");
  mig.up(db);
  registerWhiteboardHistoryMacros((_d, n, h) => macros.set(n, h));
  const r = upsertBoard(db, { ownerId: "u_alice", title: "Hist board", scene: { elements: [] } });
  boardId = r.id;
  inviteParticipant(db, { boardId, userId: "u_view", role: "viewer" });
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("whiteboard-history: list", () => {
  it("rejects forbidden user", async () => {
    const r = await macros.get("history_list")({ db, actor: { userId: "u_outsider" } }, { boardId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });

  it("returns navigable versions only (scene_replace / snapshot / restore)", async () => {
    appendDelta(db, { boardId, userId: "u_alice", deltaKind: "scene_replace", delta: { reason: "v1" }, newScene: { elements: [{ id: "e1" }] } });
    appendDelta(db, { boardId, userId: "u_alice", deltaKind: "element_add", delta: { id: "e2" } });
    appendDelta(db, { boardId, userId: "u_alice", deltaKind: "scene_replace", delta: { reason: "v2" }, newScene: { elements: [{ id: "e1" }, { id: "e2" }] } });
    const r = await macros.get("history_list")({ db, actor: { userId: "u_view" } }, { boardId });
    assert.equal(r.ok, true);
    // 2 scene_replace versions (newest first after reverse)
    assert.ok(r.versions.length >= 2);
    for (const v of r.versions) {
      assert.ok(["scene_replace", "snapshot", "restore"].includes(v.kind), `${v.kind} should be navigable`);
    }
  });

  it("tracks following_deltas count per version", async () => {
    const r = await macros.get("history_list")({ db, actor: { userId: "u_alice" } }, { boardId });
    // First version (oldest) had one following element_add delta before next scene_replace
    const oldest = r.versions[r.versions.length - 1]; // reversed
    assert.equal(oldest.following_deltas, 1);
  });
});

describe("whiteboard-history: restore", () => {
  it("rejects viewer (editor+ required)", async () => {
    // pick any delta id
    const someDelta = db.prepare(`SELECT id FROM whiteboard_scene_deltas WHERE board_id = ? LIMIT 1`).get(boardId);
    const r = await macros.get("history_restore")({ db, actor: { userId: "u_view" } }, { boardId, deltaId: someDelta.id });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });

  it("rejects unknown delta id", async () => {
    const r = await macros.get("history_restore")({ db, actor: { userId: "u_alice" } }, { boardId, deltaId: 999_999 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "delta_not_found");
  });

  it("rejects non-navigable delta (e.g. element_add)", async () => {
    const addDelta = db.prepare(`SELECT id FROM whiteboard_scene_deltas WHERE board_id = ? AND delta_kind = 'element_add' LIMIT 1`).get(boardId);
    const r = await macros.get("history_restore")({ db, actor: { userId: "u_alice" } }, { boardId, deltaId: addDelta.id });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "delta_not_navigable");
  });

  it("owner can restore to an earlier scene_replace", async () => {
    const earliest = db.prepare(`SELECT id FROM whiteboard_scene_deltas WHERE board_id = ? AND delta_kind = 'scene_replace' ORDER BY id ASC LIMIT 1`).get(boardId);
    const r = await macros.get("history_restore")({ db, actor: { userId: "u_alice" } }, { boardId, deltaId: earliest.id });
    assert.equal(r.ok, true);
    assert.ok(r.sceneElementCount >= 1);
    // Verify the board's scene now matches the restored snapshot.
    const row = getBoard(db, boardId);
    assert.equal(row.scene.elements.length, r.sceneElementCount);
  });
});
