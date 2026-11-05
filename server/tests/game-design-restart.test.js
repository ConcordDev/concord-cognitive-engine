// A design title is stored in game_designs. Clearing the in-memory
// gameDesignLens (what a process restart does) still lists that title.
// Genre and platform are not stored, so they come back null.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerGameDesignActions from "../domains/gamedesign.js";
import { up, down } from "../migrations/458_game_designs.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`game-design.${name}`);
  assert.ok(fn, `game-design.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerGameDesignActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up(db);
  globalThis._concordSTATE = { db, gameDesignLens: {} };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "user_design" }, userId: "user_design", db };

describe("game design restart", () => {
  it("lists the title after the in-memory lens is dropped", () => {
    const created = call("game-create", ctx, { title: "  Door design  " });
    assert.equal(created.ok, true);
    const id = created.result.game.id;
    assert.equal(created.result.game.title, "Door design");
    const row = db.prepare("SELECT title FROM game_designs WHERE id = ?").get(id);
    assert.equal(row.title, "Door design");

    globalThis._concordSTATE = { db, gameDesignLens: {} };
    const list = call("game-list", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.games[0].id, id);
    assert.equal(list.result.games[0].title, "Door design");
    assert.equal(list.result.games[0].genre, null);
    assert.equal(list.result.games[0].platform, null);
    assert.equal(list.result.games[0].pitch, null);
  });

  it("a blank title is rejected and stores nothing", () => {
    const created = call("game-create", ctx, { title: "   " });
    assert.equal(created.ok, false);
    assert.equal(created.error, "game title required");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM game_designs").get().n, 0);
  });

  it("a design that only exists via the DB-merge path can still be renamed, extended, and deleted", () => {
    // Every workbench macro (gdd/mechanics/entities/levels/...) gates on
    // the same gdGame() lookup as game-update/game-delete. Before the
    // hydration fix, gdGame() only checked the in-memory map, so ANY
    // design surfaced solely through game-list's DB-merge path (another
    // process, or — as simulated here — a restart) 404'd on every single
    // macro in the lens, even though game-list had just shown it as a
    // real, openable design.
    const created = call("game-create", ctx, { title: "Original Title" });
    const id = created.result.game.id;

    globalThis._concordSTATE = { db, gameDesignLens: {} };
    const listed = call("game-list", ctx, {});
    assert.equal(listed.result.games[0].id, id, "the design is only known via the DB row now");

    const updated = call("game-update", ctx, { id, title: "Renamed After Restart" });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.game.title, "Renamed After Restart");
    const row = db.prepare("SELECT title FROM game_designs WHERE id = ?").get(id);
    assert.equal(row.title, "Renamed After Restart", "the rename itself persists back to the row");

    const gdd = call("gdd-add", ctx, { gameId: id, title: "Overview", body: "A game about doors." });
    assert.equal(gdd.ok, true, "a sub-feature macro works on a design hydrated only from the DB row");

    const deleted = call("game-delete", ctx, { id });
    assert.equal(deleted.ok, true);
    assert.equal(
      db.prepare("SELECT 1 FROM game_designs WHERE id = ?").get(id),
      undefined,
      "the row is actually gone, not just the in-memory entry",
    );
  });

  it("a rename survives a SECOND restart (game-update actually persists the row, not just the in-memory copy)", () => {
    const created = call("game-create", ctx, { title: "Before Rename" });
    const id = created.result.game.id;
    const renamed = call("game-update", ctx, { id, title: "After Rename" });
    assert.equal(renamed.ok, true);

    globalThis._concordSTATE = { db, gameDesignLens: {} };
    const list = call("game-list", ctx, {});
    assert.equal(list.result.games[0].title, "After Rename", "game-update's write reached the row, not just memory");
  });

  it("down drops the table", () => {
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_designs'").get(),
      undefined,
    );
  });
});
