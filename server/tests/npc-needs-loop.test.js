/**
 * Living Society WS4 (3/3) — the live loop: needs → goal (real POI) → walk →
 * satisfy. Proves advanceRoutine now drives MOTIVATED movement to real
 * buildings and closes the loop on arrival.
 *
 * Run: node --test tests/npc-needs-loop.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up292 } from "../migrations/292_npc_needs.js";
import { advanceRoutine } from "../lib/npc-routines.js";
import { getNeeds, setNeeds } from "../lib/npc-needs.js";

const W = "concordia-hub", DAY = 1, BLK = 0;
function mkDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, current_location TEXT, spawn_location TEXT, is_dead INTEGER DEFAULT 0);
    CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT, state TEXT DEFAULT 'standing', x REAL, y REAL, z REAL);
    CREATE TABLE npc_schedules (npc_id TEXT, day_seed INTEGER, block_idx INTEGER, activity_kind TEXT, location_kind TEXT, target_x REAL, target_z REAL, generated_at INTEGER, preoccupation_signature TEXT, PRIMARY KEY (npc_id, day_seed, block_idx));
    CREATE TABLE npc_routine_state (npc_id TEXT PRIMARY KEY, current_block INTEGER, activity_kind TEXT, location_kind TEXT, target_x REAL, target_z REAL, started_at INTEGER, arrived_at INTEGER, expected_end_at INTEGER, last_signal_at INTEGER);
  `);
  up292(db);
  return db;
}

describe("WS4 — advanceRoutine drives motivated movement to real POIs", () => {
  it("on transition, a HUNGRY npc's destination becomes the real inn (not the schedule's random offset)", async () => {
    const db = mkDb();
    // schedule says go to (999, 999) — a random offset. The inn is at (20, 0).
    db.prepare(`INSERT INTO npc_schedules (npc_id, day_seed, block_idx, activity_kind, location_kind, target_x, target_z, generated_at) VALUES ('n1', ?, ?, 'socialize', 'plaza', 999, 999, 0)`).run(DAY, BLK);
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, x, y, z) VALUES ('inn1', ?, 'inn', 20, 0, 0), ('forge1', ?, 'forge', 22, 0, 0)`).run(W, W);
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, current_location, spawn_location) VALUES ('n1', ?, 'farmer', ?, ?)`)
      .run(W, JSON.stringify({ x: 0, z: 0 }), JSON.stringify({ x: 0, z: 0 }));
    setNeeds(db, "n1", { hunger: 0.95, energy: 0.1, wealth: 0.1, social: 0.1, safety: 0.1, purpose: 0.1 });

    const npc = db.prepare(`SELECT * FROM world_npcs WHERE id='n1'`).get();
    const r = await advanceRoutine(db, npc, { daySeed: DAY, blockIdx: BLK });
    assert.equal(r.ok, true);
    // routine_state target was OVERRIDDEN to the inn (20,0), NOT (999,999).
    const st = db.prepare(`SELECT target_x, target_z FROM npc_routine_state WHERE npc_id='n1'`).get();
    assert.ok(Math.hypot(st.target_x - 20, st.target_z - 0) < 1, `target ${st.target_x},${st.target_z} is not the inn`);
  });

  it("walking to the POI and arriving SATISFIES the advertised need (hunger drops)", async () => {
    const db = mkDb();
    db.prepare(`INSERT INTO npc_schedules (npc_id, day_seed, block_idx, activity_kind, location_kind, target_x, target_z, generated_at) VALUES ('n2', ?, ?, 'socialize', 'plaza', 999, 999, 0)`).run(DAY, BLK);
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, x, y, z) VALUES ('inn1', ?, 'inn', 12, 0, 0)`).run(W);
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, current_location, spawn_location) VALUES ('n2', ?, 'farmer', ?, ?)`)
      .run(W, JSON.stringify({ x: 0, z: 0 }), JSON.stringify({ x: 0, z: 0 }));
    setNeeds(db, "n2", { hunger: 0.95, energy: 0.1, wealth: 0.1, social: 0.1, safety: 0.1, purpose: 0.1 });
    const before = getNeeds(db, "n2").hunger;

    // Drive ticks until it reaches the inn (NUDGE 6m/tick, ~12m away → a couple ticks).
    for (let i = 0; i < 6; i++) {
      const npc = db.prepare(`SELECT * FROM world_npcs WHERE id='n2'`).get();
      await advanceRoutine(db, npc, { daySeed: DAY, blockIdx: BLK });
    }
    const after = getNeeds(db, "n2").hunger;
    assert.ok(after < before, `hunger did not drop on arrival (${before} -> ${after})`);
    // and it's physically at the inn
    const loc = JSON.parse(db.prepare(`SELECT current_location FROM world_npcs WHERE id='n2'`).get().current_location);
    assert.ok(Math.hypot(loc.x - 12, loc.z - 0) <= 6, "npc never reached the inn");
  });

  it("CONCORD_NPC_NEEDS=0 falls back to the pure schedule (no override)", async () => {
    process.env.CONCORD_NPC_NEEDS = "0";
    try {
      const db = mkDb();
      db.prepare(`INSERT INTO npc_schedules (npc_id, day_seed, block_idx, activity_kind, location_kind, target_x, target_z, generated_at) VALUES ('n3', ?, ?, 'socialize', 'plaza', 500, 500, 0)`).run(DAY, BLK);
      db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, x, y, z) VALUES ('inn1', ?, 'inn', 20, 0, 0)`).run(W);
      db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, current_location, spawn_location) VALUES ('n3', ?, 'farmer', ?, ?)`)
        .run(W, JSON.stringify({ x: 0, z: 0 }), JSON.stringify({ x: 0, z: 0 }));
      const npc = db.prepare(`SELECT * FROM world_npcs WHERE id='n3'`).get();
      await advanceRoutine(db, npc, { daySeed: DAY, blockIdx: BLK });
      const st = db.prepare(`SELECT target_x FROM npc_routine_state WHERE npc_id='n3'`).get();
      assert.equal(st.target_x, 500, "with needs off, the schedule target must be unchanged");
    } finally { delete process.env.CONCORD_NPC_NEEDS; }
  });
});
