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

  it("down drops the table", () => {
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_designs'").get(),
      undefined,
    );
  });
});
