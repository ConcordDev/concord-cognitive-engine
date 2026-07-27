// server/tests/byo-keys-brain-mode-macros.test.js
//
// Task #29 of the Private Mode / High Power Mode plan: the byo_keys
// domain's get_brain_mode / set_brain_mode macros, which back
// BrainModePanel.tsx (the byo-keys Settings-lens panel). These reuse
// the lens's existing authenticated /api/lens/run path rather than a
// second REST route for the same write server/routes/auth.js's
// choose-brain-mode already exposes — both write the exact same
// users.brain_mode column, read by the same
// byo-router.js#getBrainMode helper regardless of which surface wrote
// it last.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerByoKeysMacros from "../domains/byo-keys.js";
import { up as upMig397 } from "../migrations/397_brain_mode.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`byo_keys.${name}`);
  if (!fn) throw new Error(`byo_keys.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerByoKeysMacros(register); });

let db;

function seed() {
  globalThis._concordSTATE = { dtus: new Map() };
  db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY)`);
  upMig397(db);
  db.prepare(`INSERT INTO users (id) VALUES ('user_a'), ('user_b')`).run();
}

beforeEach(() => { seed(); });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a", get db() { return db; } };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b", get db() { return db; } };
const ctxNoActor = { actor: {}, get db() { return db; } };

describe("byo_keys.get_brain_mode", () => {
  it("a never-chosen account reads 'private' with a null brainModeSetAt", async () => {
    const r = await call("get_brain_mode", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.brainMode, "private");
    assert.equal(r.result.brainModeSetAt, null);
  });

  it("requires an actor", async () => {
    const r = await call("get_brain_mode", ctxNoActor);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_actor");
  });

  it("reflects a value set directly in the db", async () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`UPDATE users SET brain_mode = 'high_power', brain_mode_set_at = ? WHERE id = 'user_a'`).run(now);
    const r = await call("get_brain_mode", ctxA);
    assert.equal(r.result.brainMode, "high_power");
    assert.equal(r.result.brainModeSetAt, now);
  });
});

describe("byo_keys.set_brain_mode", () => {
  it("sets high_power and stamps brain_mode_set_at", async () => {
    const r = await call("set_brain_mode", ctxA, { brainMode: "high_power" });
    assert.equal(r.ok, true);
    assert.equal(r.result.brainMode, "high_power");
    assert.ok(Number.isFinite(r.result.brainModeSetAt));

    const row = db.prepare("SELECT brain_mode, brain_mode_set_at FROM users WHERE id = 'user_a'").get();
    assert.equal(row.brain_mode, "high_power");
    assert.ok(row.brain_mode_set_at);
  });

  it("rejects an invalid brainMode value", async () => {
    const r = await call("set_brain_mode", ctxA, { brainMode: "ultra" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_brain_mode");
  });

  it("requires an actor", async () => {
    const r = await call("set_brain_mode", ctxNoActor, { brainMode: "private" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_actor");
  });

  it("per-user isolation — setting user_a's mode never touches user_b's row", async () => {
    await call("set_brain_mode", ctxA, { brainMode: "high_power" });
    const rB = await call("get_brain_mode", ctxB);
    assert.equal(rB.result.brainMode, "private");
  });

  it("can be switched back to private", async () => {
    await call("set_brain_mode", ctxA, { brainMode: "high_power" });
    const r = await call("set_brain_mode", ctxA, { brainMode: "private" });
    assert.equal(r.result.brainMode, "private");
    const row = db.prepare("SELECT brain_mode FROM users WHERE id = 'user_a'").get();
    assert.equal(row.brain_mode, "private");
  });

  it("agrees with byo-router.js#getBrainMode's own read of the same column", async () => {
    const { getBrainMode } = await import("../lib/byo-router.js");
    await call("set_brain_mode", ctxA, { brainMode: "high_power" });
    assert.equal(getBrainMode(db, "user_a"), "high_power");
  });
});
