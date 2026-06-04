/**
 * Integration test for the Wave 7 affect/instinct hot-path wire in tickFlock.
 * Pins that perceive→feel→drive→release runs inside the ecology pass and writes
 * the affect substrate onto motion[m.id], that a sensed predator darkens prey
 * affect + raises FEAR, and that the overlay is fully reversible (opts.affect=false
 * → no affect fields, byte-identical ecology).
 *
 * Run: node --test tests/creature-affect-wire.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { tickFlock, clearMotionForWorld } from "../lib/ecosystem/creature-behaviors.js";
import { DRIVE_KINDS } from "../lib/ecosystem/drives.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, archetype TEXT NOT NULL,
      species_id TEXT, name TEXT, x REAL DEFAULT 0, y REAL DEFAULT 0, z REAL DEFAULT 0,
      level INTEGER DEFAULT 1, is_dead INTEGER DEFAULT 0
    );
    CREATE TABLE player_world_state ( user_id TEXT, world_id TEXT, x REAL, y REAL, z REAL );
  `);
  return db;
}
function spawn(db, id, worldId, species, x, z) {
  db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, name, x, z)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, worldId, `creature:${species}`, species, species, x, z);
}

test("Wave 7 — affect/instinct hot-path wire", async (t) => {
  await t.test("affect on: motion gets _affect/_drives/_dominantDrive after a tick", () => {
    const db = setupDb();
    const W = "test-world";
    // a small deer herd so cohesion has neighbours and at least one is active
    for (let i = 0; i < 6; i++) spawn(db, `deer${i}`, W, "deer", i * 3, 0);
    const state = {};
    // force ecology + affect on regardless of env
    const res = tickFlock(db, state, W, { ecology: true, affect: true });
    assert.equal(res.ok, true);
    const motionStore = state.creatureMotion?.[W] || state.creatureMotion?.get?.(W) || null;
    assert.ok(motionStore, "a motion store exists for the world");
    // at least one creature carries the affect substrate
    const withAffect = Object.values(motionStore).filter((m) => m && m._affect);
    assert.ok(withAffect.length > 0, "at least one creature has _affect");
    const sample = withAffect[0];
    assert.ok(Number.isFinite(sample._affect.v) && Number.isFinite(sample._affect.a));
    assert.ok(DRIVE_KINDS.every((k) => Number.isFinite(sample._drives[k])), "7 drives present");
    assert.ok(sample._dominantDrive === null || DRIVE_KINDS.includes(sample._dominantDrive));
  });

  await t.test("a sensed predator darkens prey affect vs a safe world", () => {
    const W = "w";
    // SAFE: a lone deer, no predator
    const safeDb = setupDb();
    spawn(safeDb, "deerS", W, "deer", 0, 0);
    const safeState = {};
    // tick a few times so affect settles (smoothing has inertia)
    for (let i = 0; i < 4; i++) tickFlock(safeDb, safeState, W, { ecology: true, affect: true });
    const safeMotion = (safeState.creatureMotion[W])["deerS"];

    // THREATENED: a deer with a wolf well inside PREDATOR_SENSE_R
    const dangerDb = setupDb();
    spawn(dangerDb, "deerD", W, "deer", 0, 0);
    spawn(dangerDb, "wolfD", W, "wolf", 5, 0);
    const dangerState = {};
    for (let i = 0; i < 4; i++) tickFlock(dangerDb, dangerState, W, { ecology: true, affect: true });
    const dangerMotion = (dangerState.creatureMotion[W])["deerD"];

    assert.ok(safeMotion?._affect && dangerMotion?._affect, "both have affect");
    assert.ok(dangerMotion._affect.v < safeMotion._affect.v,
      `threatened valence (${dangerMotion._affect.v.toFixed(2)}) < safe (${safeMotion._affect.v.toFixed(2)})`);
    assert.ok(dangerMotion._drives.FEAR > safeMotion._drives.FEAR, "predator raises FEAR");
  });

  await t.test("overlay is reversible: affect off → no affect fields", () => {
    const db = setupDb();
    const W = "w2";
    for (let i = 0; i < 4; i++) spawn(db, `d${i}`, W, "deer", i * 2, 0);
    const state = {};
    tickFlock(db, state, W, { ecology: true, affect: false });
    const motionStore = state.creatureMotion[W];
    const any = Object.values(motionStore).some((m) => m && (m._affect || m._drives));
    assert.equal(any, false, "no _affect/_drives written when overlay disabled");
  });

  await t.test("never throws when the embodied signal table is absent", () => {
    const db = setupDb(); // no embodied_signal_log
    const W = "w3";
    spawn(db, "x", W, "deer", 0, 0);
    assert.doesNotThrow(() => tickFlock(db, {}, W, { ecology: true, affect: true }));
  });
});
