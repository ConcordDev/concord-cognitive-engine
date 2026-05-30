/**
 * Living Society — Phase 9: player occupation loop (one loop for players + NPCs).
 *
 *   - a build shift raises a building via the SAME NPC labor fn;
 *   - a mining shift depletes a node + the yield lands in player_inventory;
 *   - the shift pays the employment-edge wage (or a stipend) + grants
 *     archetype-specific skill XP.
 *
 * Run: node --test tests/player-occupation.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up282 } from "../migrations/282_labor_world_state.js";
import { up as up283 } from "../migrations/283_employment_edges.js";
import { workShift, OCCUPATION_ROLES } from "../lib/player-occupation.js";

const W = "concordia-hub";
const U = "user_1";
function mkDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT, state TEXT DEFAULT 'standing', health_pct REAL DEFAULT 1.0, x REAL, y REAL, z REAL);
    CREATE TABLE world_resource_nodes (id TEXT PRIMARY KEY, world_id TEXT, node_type TEXT, resource_id TEXT, resource_name TEXT, x REAL, y REAL, z REAL, quantity_remaining INTEGER DEFAULT 100, max_quantity INTEGER DEFAULT 100, is_depleted INTEGER DEFAULT 0, respawn_hours INTEGER DEFAULT 24, respawn_at INTEGER, last_gathered_by TEXT, last_gathered_at INTEGER);
    CREATE TABLE claim_crops (claim_id TEXT, tile_x INTEGER, tile_y INTEGER, growth_stage INTEGER DEFAULT 0, watered_at INTEGER, updated_at INTEGER, PRIMARY KEY (claim_id, tile_x, tile_y));
    CREATE TABLE npc_inventory (npc_id TEXT, resource_kind TEXT, quantity INTEGER DEFAULT 0, updated_at INTEGER, PRIMARY KEY (npc_id, resource_kind));
    CREATE TABLE player_inventory (id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT DEFAULT 'concordia-hub', item_type TEXT, item_id TEXT, item_name TEXT, quantity INTEGER DEFAULT 1, quality TEXT, acquired_at INTEGER);
    CREATE TABLE users (id TEXT PRIMARY KEY, sparks INTEGER DEFAULT 0);
    CREATE TABLE sparks_ledger (id TEXT PRIMARY KEY, user_id TEXT, delta INTEGER, reason TEXT, world_id TEXT, created_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE player_skill_levels (id TEXT PRIMARY KEY, user_id TEXT, skill_type TEXT, native_world_type TEXT, level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, xp_to_next INTEGER DEFAULT 100, last_used_at INTEGER, UNIQUE(user_id, skill_type, native_world_type));
  `);
  up282(db); up283(db);
  db.prepare(`INSERT INTO users (id, sparks) VALUES (?, 0)`).run(U);
  return db;
}

describe("Phase 9 — player work shift", () => {
  it("a build shift raises a building via the NPC labor fn + pays + grants XP", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, state, x, y, z) VALUES ('b1', ?, 'house', 'construction', 0, 0, 0)`).run(W);
    const r = workShift(db, { userId: U, worldId: W, role: "builder", pos: { x: 0, z: 0 } });
    assert.equal(r.ok, true);
    assert.equal(r.activity, "build");
    assert.equal(r.effect.action, "build");
    assert.ok(r.effect.progress > 0, "building progressed");
    // paid the stipend
    assert.ok(r.wage > 0);
    assert.equal(db.prepare(`SELECT sparks FROM users WHERE id=?`).get(U).sparks, r.wage);
    // archetype-specific XP on construction (not generic crafting)
    assert.equal(r.skill, "construction");
    assert.ok(db.prepare(`SELECT 1 FROM player_skill_levels WHERE user_id=? AND skill_type='construction'`).get(U));
  });

  it("a mining shift depletes a node + the yield lands in player_inventory", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO world_resource_nodes (id, world_id, node_type, resource_id, resource_name, x, y, z, quantity_remaining, max_quantity) VALUES ('o1', ?, 'ore_vein', 'iron', 'Iron', 0, 0, 0, 20, 100)`).run(W);
    const r = workShift(db, { userId: U, worldId: W, role: "miner", pos: { x: 0, z: 0 } });
    assert.equal(r.ok, true);
    assert.ok(r.yielded, "yield captured");
    assert.equal(r.yielded.item, "ore");
    // node depleted (not minted): remaining < 20
    assert.ok(db.prepare(`SELECT quantity_remaining FROM world_resource_nodes WHERE id='o1'`).get().quantity_remaining < 20);
    // yield in PLAYER inventory, not npc_inventory
    assert.ok(db.prepare(`SELECT quantity FROM player_inventory WHERE user_id=? AND item_id='ore'`).get(U).quantity > 0);
    assert.equal(db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM npc_inventory WHERE npc_id=?`).get(U).n, 0, "no orphan npc_inventory row");
  });

  it("pays the employment-edge wage when one exists", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, state, x, y, z) VALUES ('b1', ?, 'house', 'construction', 0, 0, 0)`).run(W);
    db.prepare(`INSERT INTO employment_edges (id, world_id, employer_kind, employer_id, worker_kind, worker_id, rate_sparks, payday_freq_s) VALUES ('e1', ?, 'realm', 'r1', 'player', ?, 99, 100)`).run(W, U);
    const r = workShift(db, { userId: U, worldId: W, role: "builder" });
    assert.equal(r.wage, 99);
  });

  it("rejects an unknown role; exposes the role list", () => {
    const db = mkDb();
    assert.equal(workShift(db, { userId: U, worldId: W, role: "wizard" }).reason, "unknown_role");
    assert.ok(OCCUPATION_ROLES.includes("blacksmith"));
  });
});
