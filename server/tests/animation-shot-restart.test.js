// A shot title is stored in animation_shots. Clearing the in-memory
// animationLens (what the worst-case memory-wipe path leaves behind)
// still lists that title.
//
// A REAL process restart, however, does not leave animationLens as an
// empty Map — server/lib/lens-state-persistence.js's LENS_STATE_KEYS
// includes "animationLens", so the generic serialize/hydrate walk
// round-trips the full projects Map (every shot's frames, layers, and
// strokes), not just the title shadow in animation_shots. The second
// describe block below exercises that real path end to end.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerAnimationActions from "../domains/animation.js";
import { up, down } from "../migrations/454_animation_shots.js";
import { serializeLensState, hydrateLensState } from "../lib/lens-state-persistence.js";

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

describe("animation content survives a real restart (serialize/hydrate round trip)", () => {
  it("a drawn frame's strokes are still there, and anim-get/anim-rename/frame-add still find the shot", () => {
    const created = call("anim-create", ctx, { title: "Door slam", width: 200, height: 100, fps: 12 });
    assert.equal(created.ok, true);
    const animId = created.result.animation.id;
    const frameId = created.result.animation.frames[0].id;
    const layerId = created.result.animation.frames[0].layers[0].id;

    const stroke = call("stroke-commit-pressure", ctx, {
      animId, frameId, layerId,
      stroke: { tool: "ink", color: "#ff0000", points: [[1, 2, 0.4], [3, 4, 0.9]] },
    });
    assert.equal(stroke.ok, true);

    // Simulate a real process restart: serialize the live STATE the way
    // the heartbeat save does, drop STATE entirely (a fresh process has
    // no in-memory state at all), then hydrate from the persisted blob
    // the way boot does. This is the generic mechanism every *Lens store
    // relies on, not an animation-specific shortcut.
    const persisted = serializeLensState(globalThis._concordSTATE);
    const freshState = { db };
    hydrateLensState(freshState, persisted);
    globalThis._concordSTATE = freshState;

    assert.ok(freshState.animationLens.projects instanceof Map, "projects must rehydrate as a Map, not a plain object");

    const got = call("anim-get", ctx, { id: animId });
    assert.equal(got.ok, true, `anim-get 404'd after restart: ${got.error}`);
    assert.equal(got.result.animation.title, "Door slam");
    const rehydratedLayer = got.result.animation.frames[0].layers[0];
    assert.equal(rehydratedLayer.strokes.length, 1);
    assert.deepEqual(rehydratedLayer.strokes[0].points, [[1, 2], [3, 4]]);
    assert.equal(rehydratedLayer.strokes[0].color, "#ff0000");

    const renamed = call("anim-rename", ctx, { id: animId, title: "Door slam v2" });
    assert.equal(renamed.ok, true, `anim-rename 404'd after restart: ${renamed.error}`);

    const added = call("frame-add", ctx, { animId, afterFrameId: frameId });
    assert.equal(added.ok, true, `frame-add 404'd after restart: ${added.error}`);
    assert.equal(call("anim-get", ctx, { id: animId }).result.animation.frames.length, 2);
  });
});
