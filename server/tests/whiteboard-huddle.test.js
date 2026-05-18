// server/tests/whiteboard-huddle.test.js
//
// Tier-2 contract test for Whiteboard Sprint C Item #16 — audio
// huddles. Real migration 200 audio_rooms tables + real lib/audio-
// rooms helpers.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerWhiteboardHuddleMacros from "../domains/whiteboard-huddle.js";
import { upsertBoard, inviteParticipant } from "../lib/whiteboard/persistence.js";

let db; let boardId; const macros = new Map();

before(async () => {
  db = new Database(":memory:");
  const m208 = await import("../migrations/208_whiteboard_persistence.js");
  m208.up(db);
  const m200 = await import("../migrations/200_audio_rooms.js");
  if (typeof m200.up === "function") m200.up(db); else if (typeof m200.default === "function") m200.default(db);
  registerWhiteboardHuddleMacros((_d, n, h) => macros.set(n, h));
  const r = upsertBoard(db, { ownerId: "u_alice", title: "Huddle board" });
  boardId = r.id;
  inviteParticipant(db, { boardId, userId: "u_view", role: "viewer" });
  inviteParticipant(db, { boardId, userId: "u_editor", role: "editor" });
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("whiteboard-huddle: start / list / join / leave / end", () => {
  let roomId;
  it("editor can start a huddle", async () => {
    const r = await macros.get("huddle_start")({ db, actor: { userId: "u_editor" } }, { boardId });
    assert.equal(r.ok, true);
    assert.ok(r.roomId.startsWith(`whiteboard:${boardId}:`));
    roomId = r.roomId;
  });

  it("viewer is forbidden from starting", async () => {
    const r = await macros.get("huddle_start")({ db, actor: { userId: "u_view" } }, { boardId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });

  it("huddle_list returns active huddles scoped to board", async () => {
    const r = await macros.get("huddle_list")({ db }, { boardId });
    assert.equal(r.ok, true);
    assert.ok(r.huddles.find((h) => h.id === roomId));
  });

  it("huddle_join lets a user join as listener", async () => {
    const r = await macros.get("huddle_join")({ db, actor: { userId: "u_view" } }, { roomId });
    assert.equal(r.ok, true);
  });

  it("huddle_leave lets a user leave", async () => {
    const r = await macros.get("huddle_leave")({ db, actor: { userId: "u_view" } }, { roomId });
    assert.equal(r.ok, true);
  });

  it("huddle_end ends the huddle (host)", async () => {
    const r = await macros.get("huddle_end")({ db, actor: { userId: "u_editor" } }, { roomId });
    assert.equal(r.ok, true);
  });
});
