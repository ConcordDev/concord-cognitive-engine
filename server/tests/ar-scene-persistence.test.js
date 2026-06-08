// Contract test: AR scene persistence (migration 332 + domains/ar.js DB store).
//
// Proves authored AR scenes/targets/publishes survive a "restart": we save
// against a real DB, then wipe the in-memory globalThis bucket (simulating a
// process restart) and read back through the SAME db — the scene must still be
// there. Also confirms per-user isolation and the in-memory fallback when no db.
//
// Run: node --test server/tests/ar-scene-persistence.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate332 } from "../migrations/332_ar_scenes.js";
import registerArActions from "../domains/ar.js";

const ACTIONS = new Map();
registerArActions((domain, name, fn) => ACTIONS.set(`${domain}.${name}`, fn));
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`ar.${name}`);
  if (!fn) throw new Error(`ar.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

function freshDb() {
  const db = new Database(":memory:");
  migrate332(db);
  return db;
}

const sampleScene = { name: "Persisted AR", anchor: "plane", objects: [{ id: "o1", name: "Cube", kind: "primitive" }], behaviors: [] };

describe("AR scene persistence (DB-backed)", () => {
  let db;
  beforeEach(() => { db = freshDb(); if (globalThis._concordSTATE) delete globalThis._concordSTATE.arLens; });
  afterEach(() => { db.close(); if (globalThis._concordSTATE) delete globalThis._concordSTATE.arLens; });

  it("survives a restart: save, wipe in-memory state, read back through the same db", () => {
    const ctx = { db, userId: "u1", actor: { userId: "u1" } };
    const saved = call("sceneSave", ctx, { scene: sampleScene });
    assert.equal(saved.ok, true);
    const id = saved.result.scene.id;

    // Simulate a process restart — the in-memory bucket is gone.
    delete globalThis._concordSTATE.arLens;

    const got = call("sceneGet", ctx, { sceneId: id });
    assert.equal(got.ok, true, "scene found after restart");
    assert.equal(got.result.scene.name, "Persisted AR");
    assert.equal(got.result.scene.objects.length, 1);

    const list = call("sceneList", ctx);
    assert.equal(list.result.count, 1);
  });

  it("is scoped per-user (user_b can't read user_a's scene)", () => {
    const ctxA = { db, userId: "ua", actor: { userId: "ua" } };
    const ctxB = { db, userId: "ub", actor: { userId: "ub" } };
    const id = call("sceneSave", ctxA, { scene: sampleScene }).result.scene.id;
    const cross = call("sceneGet", ctxB, { sceneId: id });
    assert.equal(cross.ok, false);
    assert.equal(call("sceneList", ctxB).result.count, 0);
  });

  it("image targets + publishes also persist", () => {
    const ctx = { db, userId: "u2", actor: { userId: "u2" } };
    const sid = call("sceneSave", ctx, { scene: sampleScene }).result.scene.id;
    const t = call("imageTargetCompile", ctx, { name: "marker", width: 1024, height: 1024 });
    assert.equal(t.ok, true);
    const pub = call("publishScene", ctx, { sceneId: sid });
    assert.equal(pub.ok, true);

    delete globalThis._concordSTATE.arLens; // restart
    assert.equal(call("imageTargetList", ctx).result.count, 1);
  });

  it("falls back to in-memory when ctx has no db (minimal/test builds)", () => {
    const ctx = { userId: "nomem", actor: { userId: "nomem" } }; // no db
    const saved = call("sceneSave", ctx, { scene: sampleScene });
    assert.equal(saved.ok, true);
    const got = call("sceneGet", ctx, { sceneId: saved.result.scene.id });
    assert.equal(got.ok, true);
  });
});
