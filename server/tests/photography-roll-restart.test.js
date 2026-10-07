// A roll name is stored in photography_rolls. Clearing the in-memory
// photographyLens (what a process restart does) still lists that name.
// Date, location, and client are not stored, so they come back null.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerPhotographyActions from "../domains/photography.js";
import { up, down } from "../migrations/459_photography_rolls.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`photography.${name}`);
  assert.ok(fn, `photography.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerPhotographyActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up(db);
  globalThis._concordSTATE = { db, photographyLens: {} };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "user_roll" }, userId: "user_roll", db };

describe("photography roll restart", () => {
  it("lists the roll after the in-memory lens is dropped", () => {
    const created = call("shoot-create", ctx, { name: "  Door roll  " });
    assert.equal(created.ok, true);
    const id = created.result.shoot.id;
    assert.equal(created.result.shoot.name, "Door roll");
    const row = db.prepare("SELECT name FROM photography_rolls WHERE id = ?").get(id);
    assert.equal(row.name, "Door roll");

    globalThis._concordSTATE = { db, photographyLens: {} };
    const list = call("shoot-list", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.shoots[0].id, id);
    assert.equal(list.result.shoots[0].name, "Door roll");
    assert.equal(list.result.shoots[0].date, null);
    assert.equal(list.result.shoots[0].location, null);
    assert.equal(list.result.shoots[0].client, null);
    assert.equal(list.result.shoots[0].photoCount, 0);
    assert.deepEqual(list.result.shoots[0].frames, []);
  });

  it("lists the frames after the in-memory lens is dropped", () => {
    const created = call("shoot-create", ctx, { name: "Door roll", frames: ["door-1.jpg", "  door-2.jpg  "] });
    assert.equal(created.ok, true);
    assert.equal(created.result.frames.length, 2);
    const id = created.result.shoot.id;
    globalThis._concordSTATE = { db, photographyLens: {} };
    const list = call("shoot-list", ctx, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.shoots[0].id, id);
    assert.equal(list.result.shoots[0].name, "Door roll");
    assert.equal(list.result.shoots[0].photoCount, 2);
    assert.deepEqual(list.result.shoots[0].frames.map((frame) => frame.filename), ["door-1.jpg", "door-2.jpg"]);
    assert.equal(list.result.shoots[0].date, null);
  });

  it("a roll of blank filenames is rejected", () => {
    const created = call("shoot-create", ctx, { name: "Empty", frames: ["  "] });
    assert.equal(created.ok, false);
    assert.equal(created.error, "filename required");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM photography_rolls").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM photography_roll_frames").get().n, 0);
  });

  it("a blank name is rejected and stores nothing", () => {
    const created = call("shoot-create", ctx, { name: "   " });
    assert.equal(created.ok, false);
    assert.equal(created.error, "shoot name required");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM photography_rolls").get().n, 0);
  });

  it("down drops the table", () => {
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='photography_rolls'").get(),
      undefined,
    );
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='photography_roll_frames'").get(),
      undefined,
    );
  });
});
