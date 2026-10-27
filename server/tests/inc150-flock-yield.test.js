// INC-150: creature-flock-cycle yields between worlds, honours a time budget
// and rotates so every world still ticks; registry heartbeats show up in the
// loop-job tracker so event_loop_block can name them.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up083 } from "../migrations/083_creature_crossbreeding.js";
import { runCreatureFlockCycle, _resetFlockCursorForTest } from "../emergent/creature-flock-cycle.js";
import { registerHeartbeat, runHeartbeatModuleNow, _resetHeartbeatRegistry } from "../emergent/heartbeat-registry.js";
import * as loopJobs from "../lib/loop-job-tracker.js";

const WORLDS = ["w_a", "w_b", "w_c", "w_d", "w_e"];
function mkDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT NOT NULL, archetype TEXT, species_id TEXT, x REAL, y REAL DEFAULT 0, z REAL, is_dead INTEGER DEFAULT 0);
    CREATE TABLE world_visits (id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT, arrived_at INTEGER, departed_at INTEGER);
    CREATE TABLE player_world_state (user_id TEXT, world_id TEXT, x REAL, z REAL);
  `);
  up083(db);
  const ins = db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, z) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const w of WORLDS) for (let i = 0; i < 3; i++) ins.run(`${w}_${i}`, w, "creature:dust_jackal", "dust_jackal", i * 3, i * 2);
  return db;
}

describe("INC-150 creature-flock-cycle", () => {
  let db;
  beforeEach(() => { db = mkDb(); _resetFlockCursorForTest(); });

  it("processes every world in one pass when the budget allows, yielding between worlds", async () => {
    let immediates = 0;
    const tick = setInterval(() => {}, 1000); // keep loop alive
    const counter = () => { immediates++; if (immediates < 50) setImmediate(counter); };
    setImmediate(counter);
    const r = await runCreatureFlockCycle({ db, state: {}, budgetMs: 60_000 });
    clearInterval(tick);
    assert.equal(r.ok, true);
    assert.equal(r.worldsProcessed, WORLDS.length);
    assert.deepEqual(r.worldIds, WORLDS);
    assert.ok(!r.truncated);
    assert.ok(immediates >= WORLDS.length - 1, `loop ran ${immediates} immediates during the pass`);
  });

  it("a spent budget stops the pass and the cursor rotates through all worlds", async () => {
    const seen = [];
    for (let i = 0; i < WORLDS.length + 1; i++) {
      const r = await runCreatureFlockCycle({ db, state: {}, budgetMs: 0 });
      assert.equal(r.worldsProcessed, 1, "always at least one world per pass");
      assert.equal(r.truncated, true);
      seen.push(r.worldIds[0]);
    }
    assert.deepEqual(seen, [...WORLDS, WORLDS[0]]);
  });
});

describe("INC-150 heartbeat registry → loop-job tracker", () => {
  it("a main-thread heartbeat is recorded as heartbeat:<id>", async () => {
    _resetHeartbeatRegistry();
    loopJobs._resetJobsForTest();
    let sawActive = false;
    registerHeartbeat("inc150-probe", {
      frequency: 1,
      handler: () => { sawActive = loopJobs.activeJobs().some((j) => j.name === "heartbeat:inc150-probe"); },
    });
    const res = await runHeartbeatModuleNow("inc150-probe", { state: {}, db: null });
    assert.equal(res.ok, true);
    assert.equal(sawActive, true, "job is active while the handler runs");
    assert.equal(loopJobs.activeJobs().length, 0, "job closed afterwards");
    assert.ok(loopJobs.jobsInWindow(60_000, Date.now(), 10).some((j) => j.name === "heartbeat:inc150-probe"));
    _resetHeartbeatRegistry();
  });
});
