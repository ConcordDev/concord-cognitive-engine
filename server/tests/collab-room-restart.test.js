// An opened room stores its title and its selected note. Clearing the
// in-memory collabLens (what a process restart does) still lists the
// title and still opens the same note. Participants are not stored.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCollabActions from "../domains/collab.js";
import { up, down } from "../migrations/463_collab_rooms.js";

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

describe("collab room restart", () => {
  it("lists the title and opens the same note after the in-memory lens is dropped", () => {
    const created = call("room-open", ctx, { title: "  Design jam  ", note: "  the hinge note  " });
    assert.equal(created.ok, true);
    const id = created.result.roomId;
    assert.equal(created.result.room.title, "Design jam");
    assert.equal(created.result.room.note, undefined);
    const row = db.prepare("SELECT title, note FROM collab_rooms WHERE id = ?").get(id);
    assert.equal(row.title, "Design jam");
    assert.equal(row.note, "the hinge note");

    globalThis._concordSTATE = { db, collabLens: {} };
    const list = call("room-list", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.rooms[0].id, id);
    assert.equal(list.result.rooms[0].title, "Design jam");
    assert.equal(list.result.rooms[0].note, undefined);
    const detail = call("room-detail", ctx, { id });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.room.note, "the hinge note");
    assert.equal(detail.result.room.participants, undefined);
  });

  it("a blank title stores nothing", () => {
    const created = call("room-open", ctx, { title: "   ", note: "x" });
    assert.equal(created.ok, false);
    assert.equal(created.error, "room title required");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM collab_rooms").get().n, 0);
  });

  it("a blank note stores nothing", () => {
    const created = call("room-open", ctx, { title: "Design jam", note: "  " });
    assert.equal(created.ok, false);
    assert.equal(created.error, "room note required");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM collab_rooms").get().n, 0);
  });

  it("down drops the table", () => {
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='collab_rooms'").get(),
      undefined,
    );
  });
});
