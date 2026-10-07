// A shot title is stored in animation_shots. Clearing the in-memory
// animationLens (what a process restart does) still lists that title.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerAnimationActions from "../domains/animation.js";
import { up, down } from "../migrations/454_animation_shots.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`animation.${name}`);
  assert.ok(fn, `animation.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerAnimationActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up(db);
  globalThis._concordSTATE = { db, animationLens: { projects: new Map() } };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "user_shot" }, userId: "user_shot", db };

describe("animation shot restart", () => {
  it("lists the title after the in-memory lens is dropped", () => {
    const created = call("anim-create", ctx, { title: "  Door slam  " });
    assert.equal(created.ok, true);
    const id = created.result.animation.id;
    assert.equal(created.result.animation.title, "Door slam");
    const row = db.prepare("SELECT title FROM animation_shots WHERE id = ?").get(id);
    assert.equal(row.title, "Door slam");

    globalThis._concordSTATE = { db, animationLens: { projects: new Map() } };
    const list = call("anim-list", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.animations[0].id, id);
    assert.equal(list.result.animations[0].title, "Door slam");
  });

  it("a blank title is stored as the server default only when sent blank", () => {
    const created = call("anim-create", ctx, { title: "   " });
    assert.equal(created.ok, true);
    assert.equal(created.result.animation.title, "Untitled animation");
  });

  it("down drops the table", () => {
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='animation_shots'").get(),
      undefined,
    );
  });
});
