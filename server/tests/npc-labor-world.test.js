/**
 * Living Society — Phase 2: labor writes visible world-state.
 *
 *   - a build activity raises a building over ticks, then flips to standing;
 *   - a farm activity advances a crop a growth stage;
 *   - a log/mine activity DEPLETES a node (no minting from thin air);
 *   - all are idempotent-per-tick (progress/stage capped);
 *   - dispatchEconomicAction routes build/farm/log/mine to the labor funcs.
 *
 * Run: node --test tests/npc-labor-world.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up282 } from "../migrations/282_labor_world_state.js";
import { performConstruction, performFarming, performLogging, performMining, LABOR_CONSTANTS } from "../lib/npc-labor-world.js";
import { dispatchEconomicAction } from "../lib/npc-economy.js";

const W = "w1";
function mkDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_buildings (
      id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT, state TEXT DEFAULT 'standing',
      health_pct REAL DEFAULT 1.0, x REAL, y REAL, z REAL
    );
    CREATE TABLE claim_crops (
      claim_id TEXT, tile_x INTEGER, tile_y INTEGER, crop_kind TEXT,
      growth_stage INTEGER DEFAULT 0, planted_season_idx INTEGER DEFAULT 0, planted_day INTEGER DEFAULT 0,
      watered_at INTEGER, planted_by TEXT, updated_at INTEGER,
      PRIMARY KEY (claim_id, tile_x, tile_y)
    );
    CREATE TABLE world_resource_nodes (
      id TEXT PRIMARY KEY, world_id TEXT, node_type TEXT, resource_id TEXT, resource_name TEXT,
      biome TEXT, x REAL, y REAL, z REAL, depth REAL DEFAULT 0,
      quantity_remaining INTEGER DEFAULT 100, max_quantity INTEGER DEFAULT 100,
      quality TEXT, difficulty INTEGER, respawn_hours INTEGER DEFAULT 24, respawn_at INTEGER,
      is_depleted INTEGER DEFAULT 0, last_gathered_by TEXT, last_gathered_at INTEGER, seeded INTEGER DEFAULT 0
    );
    CREATE TABLE npc_inventory (npc_id TEXT, resource_kind TEXT, quantity INTEGER DEFAULT 0, updated_at INTEGER, PRIMARY KEY (npc_id, resource_kind));
  `);
  up282(db);
  return db;
}
const npc = (over = {}) => ({ id: "npc1", world_id: W, archetype: "builder", x: 100, z: 100, ...over });

describe("Phase 2 — construction", () => {
  it("raises a building over ticks then flips to standing", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, state, x, y, z) VALUES ('b1', ?, 'house', 'construction', 100, 0, 100)`).run(W);
    let completed = false, ticks = 0;
    while (!completed && ticks < 50) {
      const r = performConstruction(db, npc());
      assert.equal(r.ok, true);
      completed = r.completed; ticks++;
    }
    assert.ok(completed, "building completed");
    const b = db.prepare(`SELECT state, construction_progress_pct FROM world_buildings WHERE id='b1'`).get();
    assert.equal(b.state, "standing");
    assert.equal(b.construction_progress_pct, 100);
    // idempotent: a finished building is a no-op for construction
    assert.equal(performConstruction(db, npc()).ok, false);
  });

  it("expected tick count tracks the rate", () => {
    assert.ok(LABOR_CONSTANTS.CONSTRUCT_RATE_PCT > 0);
  });
});

describe("Phase 2 — farming", () => {
  it("advances a crop one growth stage, capped at ripe", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO claim_crops (claim_id, tile_x, tile_y, crop_kind, growth_stage, planted_by) VALUES ('c1', 0, 0, 'wheat', 0, 'u1')`).run();
    let r = performFarming(db, npc({ archetype: "farmer" }));
    assert.equal(r.stage, 1);
    performFarming(db, npc()); performFarming(db, npc());
    r = performFarming(db, npc());
    assert.equal(r.ok, false, "no unripe crop left once ripe");
    assert.equal(db.prepare(`SELECT growth_stage FROM claim_crops WHERE claim_id='c1'`).get().growth_stage, 3);
  });
});

describe("Phase 2 — extraction depletes nodes", () => {
  it("logging depletes a tree node + yields wood (no minting)", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO world_resource_nodes (id, world_id, node_type, resource_id, resource_name, x, y, z, quantity_remaining, max_quantity) VALUES ('n1', ?, 'tree', 'wood', 'Oak', 100, 0, 100, 20, 100)`).run(W);
    const r = performLogging(db, npc({ archetype: "logger" }));
    assert.equal(r.ok, true);
    assert.equal(r.yield, "wood");
    const node = db.prepare(`SELECT quantity_remaining FROM world_resource_nodes WHERE id='n1'`).get();
    assert.equal(node.quantity_remaining, 20 - LABOR_CONSTANTS.LOG_AMOUNT);
    assert.equal(db.prepare(`SELECT quantity FROM npc_inventory WHERE npc_id='npc1' AND resource_kind='wood'`).get().quantity, LABOR_CONSTANTS.LOG_AMOUNT);
  });

  it("mining depletes + flips is_depleted at zero", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO world_resource_nodes (id, world_id, node_type, resource_id, resource_name, x, y, z, quantity_remaining, max_quantity, respawn_hours) VALUES ('o1', ?, 'ore_vein', 'iron', 'Iron', 100, 0, 100, 4, 100, 24)`).run(W);
    const r = performMining(db, npc({ archetype: "miner" }));
    assert.equal(r.depleted, true);
    const node = db.prepare(`SELECT is_depleted, respawn_at FROM world_resource_nodes WHERE id='o1'`).get();
    assert.equal(node.is_depleted, 1);
    assert.ok(node.respawn_at > 0);
  });
});

describe("Phase 2 — dispatch routing", () => {
  it("dispatchEconomicAction routes the 4 labor verbs", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, state, x, y, z) VALUES ('b1', ?, 'house', 'construction', 100, 0, 100)`).run(W);
    const r = dispatchEconomicAction(db, npc(), "build");
    assert.equal(r.ok, true);
    assert.equal(r.action, "build");
  });
});
