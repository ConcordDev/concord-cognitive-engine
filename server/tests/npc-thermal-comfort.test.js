/**
 * Environment-coupled NPC comfort — the humanoid port of the wildlife umwelt
 * pipeline (lib/ecosystem/umwelt.js + creature-behaviors.js) onto NPCs.
 *
 * Proves:
 *   - HUMANOID_BASELINE is exported from umwelt.js and perceiveSignals accepts it
 *     (the same signalsForWorld → perceiveSignals filter the creature path uses);
 *   - the `comfort` need accrues from a REAL ambient-temperature reading and is
 *     relieved by a comfortable cell / by sheltering — never invented (no data →
 *     no change);
 *   - the utility scorer genuinely weighs comfort: an NPC in a bad-temperature
 *     cell scores a shelter POI higher than a comfortable one (before/after);
 *   - the new need is a strict no-op for NPCs never near a thermal extreme
 *     (comfort=0 → 0 contribution; other needs untouched);
 *   - live loop: advanceRoutine accrues comfort from a seeded cold signal, and is
 *     a no-op in a world with no signal substrate + under the kill-switch.
 *
 * Run: node --test tests/npc-thermal-comfort.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up292 } from "../migrations/292_npc_needs.js";
import {
  freshNeeds, normalizeNeeds,
  thermalDiscomfort, applyThermalComfort,
  COMFORT_ACCRUE_PER_HOUR,
} from "../lib/npc-needs.js";
import { scoreGoal, chooseNextGoal } from "../lib/npc-utility.js";
import { advertisementFor } from "../lib/npc-pois.js";
import { perceiveSignals, HUMANOID_BASELINE } from "../lib/ecosystem/umwelt.js";
import { signalsForWorld, recordSignal } from "../lib/embodied/signals.js";
import { advanceRoutine } from "../lib/npc-routines.js";

const W = "concordia-hub", DAY = 1, BLK = 0;

// ── the wildlife pipeline, ported ────────────────────────────────────────────

describe("umwelt HUMANOID_BASELINE — the humanoid perception vector", () => {
  it("is exported, total (all channels), and passes the raw temperature through perceiveSignals", () => {
    assert.ok(HUMANOID_BASELINE && typeof HUMANOID_BASELINE === "object");
    for (const c of ["thermal", "humidity", "airQuality", "light", "sound", "pressure", "structural"]) {
      assert.equal(HUMANOID_BASELINE[c], 1, `${c} weighted 1 (full balanced band)`);
    }
    const perceived = perceiveSignals({ hasData: true, temperature: -12, humidity: 40, light: 100 }, HUMANOID_BASELINE);
    assert.equal(perceived.temperature, -12, "perception passes the raw ambient temp through");
  });
});

// ── pure: discomfort from a real reading ─────────────────────────────────────

describe("thermalDiscomfort — real ambient temperature → discomfort intensity", () => {
  it("is 0 inside the comfortable band (near 18°C)", () => {
    assert.equal(thermalDiscomfort({ hasData: true, temperature: 18 }), 0);
    assert.equal(thermalDiscomfort({ hasData: true, temperature: 22 }), 0, "22°C still comfortable");
    assert.equal(thermalDiscomfort({ hasData: true, temperature: 12 }), 0, "12°C still comfortable");
  });
  it("climbs as the temperature departs neutral (cold AND hot)", () => {
    const cold = thermalDiscomfort({ hasData: true, temperature: -10 });
    const hot  = thermalDiscomfort({ hasData: true, temperature: 46 });
    assert.ok(cold > 0.5, `deep cold is very uncomfortable (${cold})`);
    assert.ok(hot > 0.5, `searing heat is very uncomfortable (${hot})`);
    assert.ok(thermalDiscomfort({ hasData: true, temperature: 30 }) < cold, "mild warmth < deep cold");
  });
  it("never invents pressure: no data / garbage / missing temp → 0", () => {
    assert.equal(thermalDiscomfort({ hasData: false, temperature: -40 }), 0);
    assert.equal(thermalDiscomfort(null), 0);
    assert.equal(thermalDiscomfort({ hasData: true }), 0, "no temperature field → 0");
    assert.equal(thermalDiscomfort({ hasData: true, temperature: "nonsense" }), 0);
  });
});

// ── pure: comfort need accrue / relieve ──────────────────────────────────────

describe("applyThermalComfort — accrues in the cold, relaxes when comfortable/sheltered", () => {
  const base = freshNeeds();

  it("an extreme un-sheltered cell raises comfort toward the discomfort intensity", () => {
    const cold = { hasData: true, temperature: -10 };
    const after = applyThermalComfort(base, cold, 1 /* hour */, { sheltered: false });
    assert.ok(after.comfort > base.comfort, "comfort deficit climbed from a real cold reading");
    assert.ok(after.comfort <= thermalDiscomfort(cold) + 1e-9, "never overshoots the discomfort intensity");
  });

  it("accrual rate matches COMFORT_ACCRUE_PER_HOUR × elapsed (deterministic)", () => {
    const cold = { hasData: true, temperature: -10 };
    const dt = 0.1;
    const after = applyThermalComfort({ ...base, comfort: 0 }, cold, dt, { sheltered: false });
    assert.equal(Number(after.comfort.toFixed(6)), Number((COMFORT_ACCRUE_PER_HOUR * dt).toFixed(6)));
  });

  it("a comfortable cell relaxes comfort back toward 0", () => {
    const warm = { hasData: true, temperature: 19 };
    const after = applyThermalComfort({ ...base, comfort: 0.6 }, warm, 1, { sheltered: false });
    assert.ok(after.comfort < 0.6, "comfort deficit relaxed in a comfortable cell");
  });

  it("SHELTERING relieves even when the outdoor cell is freezing", () => {
    const cold = { hasData: true, temperature: -10 };
    const after = applyThermalComfort({ ...base, comfort: 0.6 }, cold, 1, { sheltered: true });
    assert.ok(after.comfort < 0.6, "being indoors relieves thermal discomfort");
  });

  it("no real reading → needs returned UNCHANGED (honest no-op, no invented drift)", () => {
    const start = { ...base, comfort: 0.4 };
    const same = applyThermalComfort(start, { temperature: -30 }, 1, { hasData: false });
    assert.equal(same.comfort, 0.4, "hasData:false leaves comfort exactly as-is");
  });

  it("only comfort changes — every other need passes through untouched", () => {
    const start = normalizeNeeds({ hunger: 0.51, energy: 0.33, wealth: 0.22, social: 0.44, safety: 0.11, purpose: 0.66, comfort: 0 });
    const after = applyThermalComfort(start, { hasData: true, temperature: -10 }, 1, { sheltered: false });
    for (const k of ["hunger", "energy", "wealth", "social", "safety", "purpose"]) {
      assert.equal(after[k], start[k], `${k} must be untouched by the thermal layer`);
    }
    assert.ok(after.comfort > 0, "comfort did change");
  });
});

// ── utility: the scorer weighs the environmental term ─────────────────────────

describe("scoreGoal weighs comfort — a bad-temperature NPC seeks shelter", () => {
  const npc = { id: "n", archetype: "default" };
  const SHELTER = { id: "sh1", type: "shelter", dist: 15, advertises: advertisementFor("shelter") };
  const FORGE   = { id: "f1",  type: "forge",   dist: 15, advertises: advertisementFor("forge") };

  // comfortable vs cold NPCs, identical except for the comfort deficit.
  const comfy = normalizeNeeds({ hunger: 0.2, energy: 0.2, wealth: 0.2, social: 0.2, safety: 0.1, purpose: 0.2, comfort: 0 });
  const cold  = { ...comfy, comfort: 0.85 };

  it("shelter advertises comfort (the new POI kind is registered)", () => {
    assert.ok(advertisementFor("shelter").comfort > 0, "shelter POI kind advertises comfort");
    assert.ok(advertisementFor("house").comfort > 0, "a house is real thermal shelter");
    assert.ok(advertisementFor("inn").comfort > 0, "an inn is real thermal shelter");
  });

  it("an NPC in a bad-temperature cell scores the shelter HIGHER than a comfortable one", () => {
    const scoreCold  = scoreGoal(npc, cold,  SHELTER);
    const scoreComfy = scoreGoal(npc, comfy, SHELTER);
    assert.ok(scoreCold > scoreComfy, `cold NPC values shelter more (${scoreCold} > ${scoreComfy})`);
  });

  it("no-op in the common case: comfort=0 contributes nothing; a POI that doesn't advertise comfort is identical for both NPCs", () => {
    // The forge advertises no comfort → the comfort deficit cannot change its score.
    assert.equal(scoreGoal(npc, cold, FORGE), scoreGoal(npc, comfy, FORGE),
      "comfort deficit must not change the score of a non-comfort POI");
    // And a comfortable NPC's shelter score is driven only by the other advertised
    // needs (energy) — comfort contributes exactly 0.
    const shelterNoComfort = { id: "sh2", type: "shelter", dist: 15, advertises: { energy: advertisementFor("shelter").energy } };
    assert.equal(scoreGoal(npc, comfy, SHELTER), scoreGoal(npc, comfy, shelterNoComfort),
      "for a comfortable NPC the comfort advertisement adds nothing");
  });

  it("a thermally-miserable NPC will actually CHOOSE the shelter over the forge", () => {
    const pois = [SHELTER, FORGE];
    const choice = chooseNextGoal(npc, cold, pois, { topN: 1 });
    assert.equal(choice.poi.id, "sh1", "the cold NPC heads for shelter");
  });
});

// ── live loop: advanceRoutine reads the real signal each tick ─────────────────

function mkWorldDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, current_location TEXT, spawn_location TEXT, is_dead INTEGER DEFAULT 0);
    CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT, state TEXT DEFAULT 'standing', x REAL, y REAL, z REAL);
    CREATE TABLE npc_schedules (npc_id TEXT, day_seed INTEGER, block_idx INTEGER, activity_kind TEXT, location_kind TEXT, target_x REAL, target_z REAL, generated_at INTEGER, preoccupation_signature TEXT, PRIMARY KEY (npc_id, day_seed, block_idx));
    CREATE TABLE npc_routine_state (npc_id TEXT PRIMARY KEY, current_block INTEGER, activity_kind TEXT, location_kind TEXT, target_x REAL, target_z REAL, started_at INTEGER, arrived_at INTEGER, expected_end_at INTEGER, last_signal_at INTEGER);
    CREATE TABLE embodied_signal_log (
      id TEXT PRIMARY KEY, world_id TEXT, location_x REAL, location_z REAL, location_y REAL,
      cell_x INTEGER, cell_z INTEGER, channel TEXT, value REAL, source TEXT, source_id TEXT,
      observed_at INTEGER, recorded_at INTEGER, decay_at INTEGER, train_consented INTEGER DEFAULT 1
    );
  `);
  up292(db);
  return db;
}

// Seed a far-flung NPC that is already AT its (non-shelter, outdoor) station so
// the pass runs the needs/comfort block cleanly (no travel, no shelter POI).
function seedNpc(db, id, activity, locationKind) {
  const loc = JSON.stringify({ x: 500, z: 500 });
  db.prepare(`INSERT INTO npc_schedules (npc_id, day_seed, block_idx, activity_kind, location_kind, target_x, target_z, generated_at) VALUES (?, ?, ?, ?, ?, 500, 500, 0)`)
    .run(id, DAY, BLK, activity, locationKind);
  db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, current_location, spawn_location) VALUES (?, ?, 'guard', ?, ?)`)
    .run(id, W, loc, loc);
}

describe("advanceRoutine — comfort tracks the real per-cell environmental signal", () => {
  it("a seeded FREEZING cell makes an outdoor NPC's comfort deficit climb from real data", async () => {
    const db = mkWorldDb();
    // Real ambient reading: -10°C absolute in the NPC's cell.
    recordSignal(db, { worldId: W, x: 500, z: 500, channel: "thermal_os.ambient_temp", value: -10, source: "sensor", ttlSeconds: 3600 });
    // sanity: the fold sees the cold reading.
    const s = signalsForWorld(db, W, { x: 500, z: 500 });
    assert.ok(s.hasData && s.temperature <= 0, `world reads cold (${s.temperature})`);

    seedNpc(db, "cold1", "patrol", "wilds"); // outdoor, un-sheltered
    let comfort = 0;
    for (let i = 0; i < 4; i++) {
      const npc = db.prepare(`SELECT * FROM world_npcs WHERE id='cold1'`).get();
      await advanceRoutine(db, npc, { daySeed: DAY, blockIdx: BLK, now: 1000 + i * 90 });
      comfort = JSON.parse(db.prepare(`SELECT needs_json FROM world_npcs WHERE id='cold1'`).get().needs_json).comfort;
    }
    assert.ok(comfort > 0, `comfort deficit accrued from the real cold signal (${comfort})`);
  });

  it("no signal substrate → comfort stays 0 (honest no-op for a world with no data)", async () => {
    const db = mkWorldDb(); // no signals recorded
    seedNpc(db, "nodata1", "patrol", "wilds");
    for (let i = 0; i < 4; i++) {
      const npc = db.prepare(`SELECT * FROM world_npcs WHERE id='nodata1'`).get();
      await advanceRoutine(db, npc, { daySeed: DAY, blockIdx: BLK, now: 1000 + i * 90 });
    }
    const comfort = JSON.parse(db.prepare(`SELECT needs_json FROM world_npcs WHERE id='nodata1'`).get().needs_json).comfort;
    assert.equal(comfort, 0, "no environmental data → no comfort pressure invented");
  });

  it("CONCORD_NPC_THERMAL_COMFORT=0 disables the coupling even in a freezing world", async () => {
    process.env.CONCORD_NPC_THERMAL_COMFORT = "0";
    try {
      const db = mkWorldDb();
      recordSignal(db, { worldId: W, x: 500, z: 500, channel: "thermal_os.ambient_temp", value: -10, source: "sensor", ttlSeconds: 3600 });
      seedNpc(db, "off1", "patrol", "wilds");
      for (let i = 0; i < 4; i++) {
        const npc = db.prepare(`SELECT * FROM world_npcs WHERE id='off1'`).get();
        await advanceRoutine(db, npc, { daySeed: DAY, blockIdx: BLK, now: 1000 + i * 90 });
      }
      const comfort = JSON.parse(db.prepare(`SELECT needs_json FROM world_npcs WHERE id='off1'`).get().needs_json).comfort;
      assert.equal(comfort, 0, "kill-switch keeps comfort inert");
    } finally { delete process.env.CONCORD_NPC_THERMAL_COMFORT; }
  });
});
