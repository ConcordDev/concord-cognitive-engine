// Collab room lifecycle remainder (F-B row 12, D1): room-update and
// room-close over the dual store (STATE.collabLens.rooms + the
// collab_rooms SQL mirror). The close's whole point: a room deleted
// only from STATE would resurrect through room-list's SQL merge, so
// the SQL row must go in the same act — proven here by clearing the
// in-memory lens (a restart) after the close.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCollabActions from "../domains/collab.js";
import { up } from "../migrations/463_collab_rooms.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`collab.${name}`);
  assert.ok(fn, `collab.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerCollabActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up(db);
  globalThis._concordSTATE = { db, collabLens: {} };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "user_room" }, userId: "user_room", db };
const other = { actor: { userId: "user_other" }, userId: "user_other", db };

describe("collab room lifecycle remainder", () => {
  it("room-update edits both stores and survives a restart", () => {
    const created = call("room-open", ctx, { title: "Jam", note: "first note" });
    const id = created.result.roomId;
    const upd = call("room-update", ctx, { id, title: "Jam 2", note: "second note" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.room.title, "Jam 2");
    const row = db.prepare("SELECT title, note FROM collab_rooms WHERE id = ?").get(id);
    assert.equal(row.title, "Jam 2");
    assert.equal(row.note, "second note");
    globalThis._concordSTATE = { db, collabLens: {} };
    const detail = call("room-detail", ctx, { id });
    assert.equal(detail.result.room.note, "second note");
  });

  it("room-update refuses blank values and other users' rooms", () => {
    const created = call("room-open", ctx, { title: "Mine", note: "n" });
    const id = created.result.roomId;
    assert.equal(call("room-update", ctx, { id, title: "  " }).error, "room title required");
    assert.equal(call("room-update", ctx, { id }).error, "nothing_to_update");
    assert.equal(call("room-update", other, { id, title: "Theirs" }).error, "room_not_found");
    assert.equal(call("room-update", ctx, { id: "rm_nope", title: "X" }).error, "room_not_found");
  });

  it("room-close removes BOTH stores — no resurrection through the list merge", () => {
    const created = call("room-open", ctx, { title: "Doomed", note: "bye" });
    const id = created.result.roomId;
    const closed = call("room-close", ctx, { id });
    assert.equal(closed.ok, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM collab_rooms WHERE id = ?").get(id).n, 0);
    // Restart: STATE cleared — the SQL row is gone too, so nothing returns.
    globalThis._concordSTATE = { db, collabLens: {} };
    const list = call("room-list", ctx, {});
    assert.equal(list.result.count, 0);
    assert.equal(call("room-detail", ctx, { id }).error, "room_not_found");
    assert.equal(call("room-close", ctx, { id }).error, "room_not_found");
  });

  it("room-close refuses another user's room and leaves it standing", () => {
    const created = call("room-open", ctx, { title: "Not yours", note: "n" });
    const id = created.result.roomId;
    assert.equal(call("room-close", other, { id }).error, "room_not_found");
    assert.equal(call("room-list", ctx, {}).result.count, 1);
  });
});
