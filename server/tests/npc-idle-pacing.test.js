/**
 * Living Society WS0 — make the NPCs WALK (the first playtester's bug).
 *
 * An NPC that ARRIVED at its activity station used to be pinned to the exact
 * target every tick — a priest communing at the temple stood frozen as a
 * statue. Now it PACES within a small radius. These pin:
 *   - idlePaceTarget is deterministic (seeded by id + a slow time-bucket),
 *     stays within IDLE_WANDER_RADIUS_M of the station, and re-picks across
 *     buckets (a slow amble, not a jitter);
 *   - advanceRoutine moves an ARRIVED npc OFF the exact target (it paces),
 *     stays "arrived", and never lands back on {0,0} from a null position.
 *
 * Run: node --test tests/npc-idle-pacing.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { advanceRoutine, _internal } from "../lib/npc-routines.js";

const { idlePaceTarget, IDLE_WANDER_RADIUS_M, ARRIVAL_RADIUS_M } = _internal;

describe("WS0 — idlePaceTarget (the pacing point)", () => {
  it("is deterministic for the same id + time bucket", () => {
    const a = idlePaceTarget("priest_1", 100, 200, 1_000_000);
    const b = idlePaceTarget("priest_1", 100, 200, 1_000_000);
    assert.deepEqual(a, b);
  });

  it("stays within IDLE_WANDER_RADIUS_M of the station", () => {
    for (let t = 0; t < 50; t++) {
      const p = idlePaceTarget("priest_1", 100, 200, t * 1000);
      const d = Math.hypot(p.x - 100, p.z - 200);
      assert.ok(d <= IDLE_WANDER_RADIUS_M + 1e-6, `paced ${d}m from station (> ${IDLE_WANDER_RADIUS_M})`);
    }
  });

  it("re-picks a pace point across time buckets (it ambles, not freezes)", () => {
    // Two timestamps far enough apart to be different buckets.
    const p1 = idlePaceTarget("priest_1", 100, 200, 0);
    const p2 = idlePaceTarget("priest_1", 100, 200, 10_000);
    assert.notDeepEqual(p1, p2, "the pace point never changes — still a statue");
  });

  it("stays inside the arrival radius so the NPC keeps its 'arrived' status", () => {
    assert.ok(IDLE_WANDER_RADIUS_M < ARRIVAL_RADIUS_M,
      "pacing radius must be < arrival radius or the NPC flickers in/out of 'arrived'");
  });
});

// ── Integration: advanceRoutine actually paces an arrived NPC ─────────────────

function mkDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, faction TEXT,
      current_location TEXT, spawn_location TEXT, is_dead INTEGER DEFAULT 0);
    CREATE TABLE npc_schedules (npc_id TEXT, day_seed INTEGER, block_idx INTEGER, activity_kind TEXT,
      location_kind TEXT, target_x REAL, target_z REAL, generated_at INTEGER,
      preoccupation_signature TEXT, PRIMARY KEY (npc_id, day_seed, block_idx));
    CREATE TABLE npc_routine_state (npc_id TEXT PRIMARY KEY, current_block INTEGER, activity_kind TEXT,
      location_kind TEXT, target_x REAL, target_z REAL, started_at INTEGER, arrived_at INTEGER,
      expected_end_at INTEGER, last_signal_at INTEGER);
  `);
  return db;
}

const DAY = 1, BLK = 0;
function seedSchedule(db, npcId, x, z) {
  db.prepare(`INSERT INTO npc_schedules (npc_id, day_seed, block_idx, activity_kind, location_kind, target_x, target_z, generated_at)
              VALUES (?, ?, ?, 'commune', 'temple', ?, ?, 0)`).run(npcId, DAY, BLK, x, z);
}

describe("WS0 — advanceRoutine paces an arrived NPC (no statue)", () => {
  it("moves an at-station NPC OFF the exact target across ticks, staying bounded", async () => {
    const db = mkDb();
    const ST = { x: 100, z: 200 };
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, current_location, spawn_location)
                VALUES ('priest', 'concordia-hub', 'mystic', ?, ?)`)
      .run(JSON.stringify(ST), JSON.stringify(ST));
    seedSchedule(db, "priest", ST.x, ST.z);

    const positions = [];
    for (let i = 0; i < 8; i++) {
      const npc = db.prepare(`SELECT * FROM world_npcs WHERE id='priest'`).get();
      const r = await advanceRoutine(db, npc, { daySeed: DAY, blockIdx: BLK });
      assert.equal(r.ok, true, `tick ${i}: ${r.reason}`);
      positions.push(JSON.parse(db.prepare(`SELECT current_location FROM world_npcs WHERE id='priest'`).get().current_location));
    }
    // Pinned-to-exact-target would mean every position == ST. It must DRIFT.
    const moved = positions.some((p) => Math.hypot(p.x - ST.x, p.z - ST.z) > 0.05);
    const bounded = positions.every((p) => Math.hypot(p.x - ST.x, p.z - ST.z) <= IDLE_WANDER_RADIUS_M + 0.5);
    assert.ok(moved, "the priest never moved off his station — still frozen");
    assert.ok(bounded, "the priest wandered past the pacing radius");
    // and he stayed 'arrived' (within arrival radius the whole time)
    assert.ok(positions.every((p) => Math.hypot(p.x - ST.x, p.z - ST.z) <= ARRIVAL_RADIUS_M));
  });

  it("a null current_location never steps toward {0,0} (no bare-boot garbage step)", async () => {
    const db = mkDb();
    const SPAWN = { x: 50, z: 60 };
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, current_location, spawn_location)
                VALUES ('p2', 'concordia-hub', 'mystic', NULL, ?)`).run(JSON.stringify(SPAWN));
    seedSchedule(db, "p2", SPAWN.x, SPAWN.z); // station == spawn (he's home)
    const npc = db.prepare(`SELECT * FROM world_npcs WHERE id='p2'`).get();
    const r = await advanceRoutine(db, npc, { daySeed: DAY, blockIdx: BLK });
    assert.equal(r.ok, true);
    const loc = JSON.parse(db.prepare(`SELECT current_location FROM world_npcs WHERE id='p2'`).get().current_location);
    // Near spawn (50,60), NEVER near {0,0}.
    assert.ok(Math.hypot(loc.x, loc.z) > 10, "a null-position NPC stepped toward {0,0}");
  });
});
