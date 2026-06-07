// Contract test for Wave 7 / A6 creature path — the affect-trace flush cycle.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migTrace } from "../migrations/326_affect_trace_temperament.js";
import { runAffectTraceCycle } from "../emergent/affect-trace-cycle.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY)`);
  migTrace(db); // adds world_npcs.temperament_json + creature_affect_trace
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, creator_id TEXT, world_id TEXT, type TEXT, title TEXT, data TEXT, created_at INTEGER)`);
  return db;
}

// a STATE with in-memory creature motion (what tickFlock writes)
function stateWith(motions) {
  return { creatureMotion: { w1: motions } };
}

test("A6 — affect-trace flush cycle", async (t) => {
  await t.test("flushes salience-crossing creatures + mints affect_memory DTUs", () => {
    const db = setupDb();
    const state = stateWith({
      deer1: { _species: "deer", _affect: { v: -0.7, a: 0.85 }, _drives: { FEAR: 0.9 }, _dominantDrive: "FEAR", _released: "freeze_then_bolt", x: 10, z: 5 },
      hawk1: { _species: "hawk", _affect: { v: 0.4, a: 0.7 }, _drives: { SEEKING: 0.8 }, _dominantDrive: "SEEKING", x: 20, z: 8 },
      rabbit_calm: { _species: "rabbit", _affect: { v: 0.1, a: 0.1 }, _drives: { PLAY: 0.2 }, _dominantDrive: "PLAY" }, // below threshold
    });
    const r = runAffectTraceCycle({ db, state });
    assert.equal(r.ok, true);
    assert.equal(r.flushed, 2, "two salient creatures flushed, the calm one skipped");
    assert.ok(r.minted >= 1, "the strongest get an affect_memory DTU");
    const rows = db.prepare(`SELECT * FROM creature_affect_trace ORDER BY intensity DESC`).all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].dominant_drive, "FEAR", "the frightened deer is the strongest trace");
    // the minted DTU reads as a place memory
    const dtu = db.prepare(`SELECT data FROM dtus WHERE type='affect_memory' LIMIT 1`).get();
    assert.match(JSON.parse(dtu.data).human, /remembers/);
  });

  await t.test("A6 plasticity — a frightened creature's temperament drifts warier", () => {
    const db = setupDb();
    db.prepare(`INSERT INTO world_npcs (id) VALUES ('deer1')`).run();
    const state = stateWith({
      deer1: { _species: "deer", _affect: { v: -0.7, a: 0.9 }, _drives: { FEAR: 0.9 }, _dominantDrive: "FEAR", x: 1, z: 1 },
    });
    runAffectTraceCycle({ db, state });
    const t = JSON.parse(db.prepare(`SELECT temperament_json FROM world_npcs WHERE id='deer1'`).get().temperament_json);
    assert.ok(t.FEAR > 0.3, "the fright nudged resting FEAR above the flat baseline");
  });

  await t.test("kill-switch disables the flush", () => {
    const db = setupDb();
    const prev = process.env.CONCORD_AFFECT_TRACE;
    process.env.CONCORD_AFFECT_TRACE = "0";
    const r = runAffectTraceCycle({ db, state: stateWith({ d: { _species: "deer", _affect: { v: -0.7, a: 0.9 }, _drives: { FEAR: 0.9 }, _dominantDrive: "FEAR" } }) });
    assert.equal(r.reason, "disabled");
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM creature_affect_trace`).get().c, 0);
    if (prev === undefined) delete process.env.CONCORD_AFFECT_TRACE; else process.env.CONCORD_AFFECT_TRACE = prev;
  });

  await t.test("never throws — no state, no table, garbage", () => {
    assert.doesNotThrow(() => runAffectTraceCycle({}));
    assert.equal(runAffectTraceCycle({}).ok, true);
    assert.equal(runAffectTraceCycle({ db: null, state: null }).ok, true);
    // missing trace table → degrades, doesn't throw
    const bare = new Database(":memory:");
    assert.doesNotThrow(() => runAffectTraceCycle({ db: bare, state: stateWith({ d: { _species: "deer", _affect: { v: -0.7, a: 0.9 }, _drives: { FEAR: 0.9 }, _dominantDrive: "FEAR" } }) }));
  });
});
