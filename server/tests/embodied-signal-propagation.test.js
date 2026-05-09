/**
 * Tier-2 contract tests for Theme 3 (game-feel pass): chemistry-cascade.
 *
 * Pins:
 *   - propagateThermal: fire spreads to a dry adjacent cell with
 *     flammable buildings, NOT to a wet cell, NOT to a cell without
 *     flammable buildings.
 *   - propagateMoisture: rain/storm humidity bumps adjacent dry cells.
 *   - evaluateCombos: hot+humid → steam, very-hot → smoke (drops AQ),
 *     hot+humid+very-hot → evaporate (drops humidity), steam cleanses
 *     existing poison.
 *   - propagateLightningChain: wet ground + lightning → returns targets
 *     within radius (sorted by distance, capped); excludes original
 *     target; dry ground → no chain.
 *   - Heartbeat handler returns plain stats and never throws on missing
 *     world_visits.
 *
 * Run: node --test tests/embodied-signal-propagation.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { recordSignal, signalsForWorld, CELL_SIZE } from "../lib/embodied/signals.js";
import {
  propagateThermal,
  propagateMoisture,
  evaluateCombos,
  propagateLightningChain,
  TUNING,
} from "../lib/embodied/signal-propagation.js";
import { runSignalPropagationCycle } from "../emergent/signal-propagation-cycle.js";
import { up as up112 } from "../migrations/112_embodied_signals.js";
import { up as up113 } from "../migrations/113_embodied_signal_log_unification.js";
import { up as up145 } from "../migrations/148_signal_propagation_indexes.js";

function setupDb({ withBuildings = true, withWorldNpcs = true, withPlayerState = true } = {}) {
  const db = new Database(":memory:");
  up112(db);
  up113(db);
  up145(db);
  if (withBuildings) {
    db.exec(`
      CREATE TABLE world_buildings (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        building_type TEXT NOT NULL,
        material TEXT,
        x REAL NOT NULL,
        y REAL,
        z REAL NOT NULL,
        state TEXT,
        health_pct REAL DEFAULT 1.0
      );
    `);
  }
  if (withWorldNpcs) {
    db.exec(`
      CREATE TABLE world_npcs (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        archetype TEXT,
        name TEXT,
        x REAL NOT NULL DEFAULT 0,
        y REAL,
        z REAL NOT NULL DEFAULT 0,
        is_dead INTEGER DEFAULT 0
      );
    `);
  }
  if (withPlayerState) {
    db.exec(`
      CREATE TABLE player_world_state (
        user_id TEXT,
        world_id TEXT,
        x REAL, y REAL, z REAL
      );
    `);
  }
  return db;
}

function placeBuilding(db, { id, worldId, x, z, material, state = "standing" }) {
  db.prepare(`
    INSERT INTO world_buildings (id, world_id, building_type, material, x, y, z, state, health_pct)
    VALUES (?, ?, 'house', ?, ?, 0, ?, ?, 1.0)
  `).run(id, worldId, material, x, z, state);
}

describe("propagateThermal — fire spread", () => {
  let db;

  beforeEach(() => {
    db = setupDb();
  });

  it("spreads to a dry adjacent cell with flammable nearby building", () => {
    const W = "concordia-hub";
    // Hot cell at origin (cell_x=0, cell_z=0)
    recordSignal(db, {
      worldId: W, x: 25, z: 25,
      channel: "thermal_os.ambient_temp", value: 50,
      source: "skill_cast", ttlSeconds: 600,
    });
    // Adjacent cell to the east (cell_x=1, cell_z=0) — flammable wood
    placeBuilding(db, { id: "b_east", worldId: W, x: 75, z: 25, material: "wood" });

    const written = propagateThermal(db, W);
    assert.ok(written >= 1, `expected ≥1 cell to receive heat, got ${written}`);

    // Check the eastern cell now has thermal_os.ambient_temp delta from
    // world_event source.
    const rows = db.prepare(`
      SELECT * FROM embodied_signal_log
       WHERE world_id = ? AND channel = 'thermal_os.ambient_temp'
         AND source = 'world_event' AND source_id = 'fire_spread'
    `).all(W);
    assert.ok(rows.length >= 1);
  });

  it("does NOT spread to a wet cell (humidity > SPREAD_WET_MIN)", () => {
    const W = "concordia-hub";
    recordSignal(db, {
      worldId: W, x: 25, z: 25,
      channel: "thermal_os.ambient_temp", value: 60,
      source: "skill_cast", ttlSeconds: 600,
    });
    // Adjacent cell soaked with humidity
    recordSignal(db, {
      worldId: W, x: 75, z: 25,
      channel: "chemical_os.humidity", value: 95,
      source: "world_event", ttlSeconds: 600,
    });
    placeBuilding(db, { id: "b_east", worldId: W, x: 75, z: 25, material: "wood" });

    propagateThermal(db, W);
    const sig = signalsForWorld(db, W, { x: 75, z: 25 });
    // Cell humidity stays high; thermal didn't spread (no propagation row).
    const spreadRows = db.prepare(`
      SELECT * FROM embodied_signal_log
       WHERE world_id = ? AND channel = 'thermal_os.ambient_temp'
         AND source_id = 'fire_spread'
         AND cell_x = 1 AND cell_z = 0
    `).all(W);
    assert.equal(spreadRows.length, 0);
    assert.ok(sig.humidity > 80);
  });

  it("does NOT spread to a cell without a flammable building", () => {
    const W = "concordia-hub";
    recordSignal(db, {
      worldId: W, x: 25, z: 25,
      channel: "thermal_os.ambient_temp", value: 60,
      source: "skill_cast", ttlSeconds: 600,
    });
    placeBuilding(db, { id: "b_stone", worldId: W, x: 75, z: 25, material: "stone" });

    propagateThermal(db, W);
    const spreadRows = db.prepare(`
      SELECT * FROM embodied_signal_log
       WHERE world_id = ? AND source_id = 'fire_spread'
    `).all(W);
    assert.equal(spreadRows.length, 0);
  });

  it("returns 0 when no hot cells", () => {
    assert.equal(propagateThermal(db, "concordia-hub"), 0);
  });
});

describe("propagateMoisture — rain spread", () => {
  it("bumps humidity in dry cells when world weather is rain/storm", () => {
    const db = setupDb();
    const W = "concordia-hub";
    // Weather signature: high humidity sets weatherKind=rain in signalsForWorld
    recordSignal(db, {
      worldId: W, x: 25, z: 25,
      channel: "chemical_os.humidity", value: 80,
      source: "world_seed", ttlSeconds: 600,
    });
    // A dry cell at (1,0)
    recordSignal(db, {
      worldId: W, x: 75, z: 25,
      channel: "chemical_os.humidity", value: 30,
      source: "world_event", ttlSeconds: 600,
    });
    const written = propagateMoisture(db, W);
    assert.ok(written >= 1);
  });

  it("returns 0 in clear weather", () => {
    const db = setupDb();
    const W = "concordia-hub";
    // Default state: no signals → weatherKind = 'clear'
    assert.equal(propagateMoisture(db, W), 0);
  });
});

describe("evaluateCombos — second-order chemistry", () => {
  it("emits steam when cell is hot AND humid", () => {
    const db = setupDb();
    const W = "concordia-hub";
    recordSignal(db, { worldId: W, x: 25, z: 25, channel: "thermal_os.ambient_temp", value: 45, source: "skill_cast", ttlSeconds: 600 });
    recordSignal(db, { worldId: W, x: 25, z: 25, channel: "chemical_os.humidity", value: 80, source: "skill_cast", ttlSeconds: 600 });
    const r = evaluateCombos(db, W);
    assert.ok(r.steam >= 1, `steam not produced: ${JSON.stringify(r)}`);
    const steamRows = db.prepare(`
      SELECT * FROM embodied_signal_log WHERE world_id=? AND channel='chemical_os.steam_density'
    `).all(W);
    assert.ok(steamRows.length >= 1);
  });

  it("does NOT emit steam in dry hot cells", () => {
    const db = setupDb();
    const W = "concordia-hub";
    recordSignal(db, { worldId: W, x: 25, z: 25, channel: "thermal_os.ambient_temp", value: 45, source: "skill_cast", ttlSeconds: 600 });
    // cell humidity stays at default (~50), below STEAM_HUM_MIN=75
    const r = evaluateCombos(db, W);
    assert.equal(r.steam, 0);
  });

  it("emits smoke when cell is very hot — drops air quality", () => {
    const db = setupDb();
    const W = "concordia-hub";
    recordSignal(db, { worldId: W, x: 25, z: 25, channel: "thermal_os.ambient_temp", value: 60, source: "skill_cast", ttlSeconds: 600 });
    const r = evaluateCombos(db, W);
    assert.ok(r.smoke >= 1);
    const smoke = db.prepare(`
      SELECT * FROM embodied_signal_log WHERE world_id=? AND channel='chemical_os.air_quality' AND source_id='combo_smoke'
    `).all(W);
    assert.ok(smoke.length >= 1);
    assert.ok(smoke[0].value < 0); // negative delta = drop in AQ
  });

  it("steam cleanses existing poison in same cell", () => {
    const db = setupDb();
    const W = "concordia-hub";
    recordSignal(db, { worldId: W, x: 25, z: 25, channel: "chemical_os.poison_density", value: 0.5, source: "skill_cast", ttlSeconds: 600 });
    recordSignal(db, { worldId: W, x: 25, z: 25, channel: "thermal_os.ambient_temp", value: 45, source: "skill_cast", ttlSeconds: 600 });
    recordSignal(db, { worldId: W, x: 25, z: 25, channel: "chemical_os.humidity", value: 80, source: "skill_cast", ttlSeconds: 600 });
    const r = evaluateCombos(db, W);
    assert.ok(r.steam >= 1);
    assert.ok(r.poisonCleansed >= 1, `cleanse failed: ${JSON.stringify(r)}`);
  });

  it("evaporate triggers when very hot AND humid", () => {
    const db = setupDb();
    const W = "concordia-hub";
    recordSignal(db, { worldId: W, x: 25, z: 25, channel: "thermal_os.ambient_temp", value: 50, source: "skill_cast", ttlSeconds: 600 });
    recordSignal(db, { worldId: W, x: 25, z: 25, channel: "chemical_os.humidity", value: 80, source: "skill_cast", ttlSeconds: 600 });
    const r = evaluateCombos(db, W);
    assert.ok(r.evap >= 1, `evap failed: ${JSON.stringify(r)}`);
  });
});

describe("propagateLightningChain — chain damage on wet ground", () => {
  let db;
  const W = "concordia-hub";

  beforeEach(() => {
    db = setupDb();
    // Wet source cell
    recordSignal(db, { worldId: W, x: 0, z: 0, channel: "chemical_os.humidity", value: 90, source: "skill_cast", ttlSeconds: 600 });
  });

  it("returns nearby NPCs and players within CHAIN_RADIUS_M, sorted by distance", () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, x, z, is_dead) VALUES (?, ?, 'warrior', ?, ?, 0)`)
      .run("npc_a", W, 1, 1); // dist ~1.4m
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, x, z, is_dead) VALUES (?, ?, 'warrior', ?, ?, 0)`)
      .run("npc_far", W, 10, 10); // dist ~14m, beyond CHAIN_RADIUS_M=4
    db.prepare(`INSERT INTO player_world_state (user_id, world_id, x, y, z) VALUES (?, ?, ?, ?, ?)`)
      .run("user_alice", W, 2, 0, 0); // dist 2m

    const r = propagateLightningChain(db, W, { x: 0, z: 0 }, 100, "npc_orig");
    assert.ok(r.ok);
    assert.equal(r.targets.length, 2);
    assert.equal(r.targets[0].id, "npc_a"); // closest first
    assert.ok(r.chainDamage > 0);
    assert.equal(r.chainDamage, Math.round(100 * TUNING.CHAIN_MAGNITUDE_FACTOR * 10) / 10);
  });

  it("excludes the original target", () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, x, z, is_dead) VALUES (?, ?, 'warrior', ?, ?, 0)`)
      .run("npc_orig", W, 0, 0);
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, x, z, is_dead) VALUES (?, ?, 'warrior', ?, ?, 0)`)
      .run("npc_other", W, 1, 1);
    const r = propagateLightningChain(db, W, { x: 0, z: 0 }, 50, "npc_orig");
    assert.ok(r.targets.every((t) => t.id !== "npc_orig"));
  });

  it("returns no targets when source cell is dry", () => {
    const db2 = setupDb();
    const W2 = "frontier-glade";
    // No humidity signal → defaults to ~50%, below CHAIN_HUMID_MIN=80
    db2.prepare(`INSERT INTO world_npcs (id, world_id, archetype, x, z, is_dead) VALUES (?, ?, 'warrior', ?, ?, 0)`)
      .run("npc_a", W2, 1, 1);
    const r = propagateLightningChain(db2, W2, { x: 0, z: 0 }, 100);
    assert.equal(r.targets.length, 0);
    assert.equal(r.reason, "dry_cell");
  });

  it("caps at CHAIN_MAX_TARGETS", () => {
    for (let i = 0; i < 20; i++) {
      db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, x, z, is_dead) VALUES (?, ?, 'warrior', ?, ?, 0)`)
        .run(`npc_${i}`, W, Math.cos(i) * 2, Math.sin(i) * 2);
    }
    const r = propagateLightningChain(db, W, { x: 0, z: 0 }, 100);
    assert.ok(r.targets.length <= TUNING.CHAIN_MAX_TARGETS);
  });

  it("returns reason on missing magnitude", () => {
    const r = propagateLightningChain(db, W, { x: 0, z: 0 }, 0);
    assert.equal(r.reason, "no_magnitude");
  });
});

describe("runSignalPropagationCycle heartbeat", () => {
  it("returns plain stats with no errors when world has data", async () => {
    const db = setupDb();
    db.exec(`CREATE TABLE world_visits (world_id TEXT, user_id TEXT, departed_at INTEGER)`);
    db.prepare(`INSERT INTO world_visits (world_id, user_id, departed_at) VALUES (?, ?, NULL)`)
      .run("concordia-hub", "user_alice");
    recordSignal(db, { worldId: "concordia-hub", x: 25, z: 25, channel: "thermal_os.ambient_temp", value: 60, source: "skill_cast", ttlSeconds: 600 });
    placeBuilding(db, { id: "b1", worldId: "concordia-hub", x: 75, z: 25, material: "wood" });
    const r = await runSignalPropagationCycle({ db, state: {}, tickCount: 1 });
    assert.equal(r.ok, true);
    assert.equal(typeof r.thermalSpread, "number");
  });

  it("disabled by env returns reason='disabled'", async () => {
    process.env.CONCORD_SIGNAL_PROPAGATION = "0";
    const r = await runSignalPropagationCycle({ db: null });
    delete process.env.CONCORD_SIGNAL_PROPAGATION;
    assert.equal(r.ok, false);
    assert.equal(r.reason, "disabled");
  });

  it("returns no_db when db missing", async () => {
    const r = await runSignalPropagationCycle({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("survives missing world_visits + signal-log gracefully", async () => {
    const blank = new Database(":memory:");
    const r = await runSignalPropagationCycle({ db: blank });
    assert.equal(r.ok, true);
  });
});

// Sanity: tunables exposed
describe("TUNING constants", () => {
  it("are sensible defaults", () => {
    assert.ok(TUNING.FIRE_HOT_MIN > 0);
    assert.ok(TUNING.SPREAD_DRY_MAX < TUNING.SPREAD_WET_MIN);
    assert.ok(TUNING.CHAIN_HUMID_MIN > 50);
    assert.ok(TUNING.CHAIN_RADIUS_M > 0);
    assert.ok(TUNING.CHAIN_MAGNITUDE_FACTOR > 0 && TUNING.CHAIN_MAGNITUDE_FACTOR < 1);
    assert.equal(typeof CELL_SIZE, "number");
  });
});
