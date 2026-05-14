/**
 * Tier-2 contract tests for Phase U: mount-behavior-cycle.
 *
 * Pins:
 *   - migration 190 adds behavior_state / pos_x / pos_z / behavior_updated_at columns
 *   - runMountBehaviorCycle picks wandering for an idle loose mount with no predator
 *   - runMountBehaviorCycle picks fleeing when a predator is within range
 *   - runMountBehaviorCycle picks feeding when hunger is high + a food node is nearby
 *   - state changes emit mount:behavior socket events (counted via emits)
 *
 * Run: node --test tests/mount-behavior.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up190 } from "../migrations/190_mount_behavior.js";
import { runMountBehaviorCycle } from "../emergent/mount-behavior-cycle.js";

function fresh() {
  const db = new Database(":memory:");
  // Minimal schema slice for this test.
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_companions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      creature_id TEXT NOT NULL,
      name TEXT,
      tame_bond REAL DEFAULT 100,
      loyalty REAL DEFAULT 50,
      level INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      caught_at INTEGER NOT NULL DEFAULT (unixepoch()),
      world_id TEXT NOT NULL,
      deployed INTEGER NOT NULL DEFAULT 0,
      last_action_at INTEGER,
      mount_eligible INTEGER DEFAULT 1,
      mount_state TEXT DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      archetype TEXT,
      current_location TEXT DEFAULT '{}',
      is_dead INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS world_resource_nodes (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      kind TEXT,
      x REAL,
      z REAL
    );
  `);
  up190(db);
  return db;
}

describe("Phase U migration 190", () => {
  it("adds behavior_state / pos_x / pos_z / behavior_updated_at to player_companions", () => {
    const db = fresh();
    const cols = db.prepare(`PRAGMA table_info(player_companions)`).all().map(c => c.name);
    for (const c of ['behavior_state', 'pos_x', 'pos_z', 'behavior_updated_at']) {
      assert.ok(cols.includes(c), `${c} should exist`);
    }
  });
});

describe("Phase U mount-behavior-cycle", () => {
  it("picks wandering for an idle loose mount with no predator + no hunger", async () => {
    const db = fresh();
    db.prepare(`INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible, deployed, mount_state, pos_x, pos_z, behavior_state) VALUES (?, ?, ?, ?, ?, 1, 0, '{"hunger":10}', 0, 0, 'feeding')`)
      .run('m1', 'u1', 'crt1', 'Bay', 'concordia-hub');
    const r = await runMountBehaviorCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.processed, 1);
    const after = db.prepare(`SELECT behavior_state FROM player_companions WHERE id = ?`).get('m1');
    assert.equal(after.behavior_state, 'wandering');
  });

  it("picks fleeing when a predator is within range", async () => {
    const db = fresh();
    db.prepare(`INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible, deployed, mount_state, pos_x, pos_z, behavior_state) VALUES (?, ?, ?, ?, ?, 1, 0, '{}', 10, 10, 'wandering')`)
      .run('m2', 'u1', 'crt2', 'Roan', 'concordia-hub');
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, current_location) VALUES (?, ?, ?, ?)`)
      .run('predator1', 'concordia-hub', 'creature_hunter', JSON.stringify({ x: 15, z: 15 }));
    const r = await runMountBehaviorCycle({ db });
    assert.equal(r.processed, 1);
    const after = db.prepare(`SELECT behavior_state, pos_x, pos_z FROM player_companions WHERE id = ?`).get('m2');
    assert.equal(after.behavior_state, 'fleeing');
    // Should have moved AWAY from (15,15) — i.e., position is < starting (10,10).
    assert.ok(after.pos_x < 10 || after.pos_z < 10, 'should flee away from predator');
  });

  it("picks feeding when hunger is high + food node nearby", async () => {
    const db = fresh();
    db.prepare(`INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible, deployed, mount_state, pos_x, pos_z, behavior_state) VALUES (?, ?, ?, ?, ?, 1, 0, '{"hunger":80}', 0, 0, 'wandering')`)
      .run('m3', 'u1', 'crt3', 'Black', 'concordia-hub');
    db.prepare(`INSERT INTO world_resource_nodes (id, world_id, kind, x, z) VALUES (?, ?, ?, ?, ?)`)
      .run('food1', 'concordia-hub', 'herb', 5, 5);
    const r = await runMountBehaviorCycle({ db });
    assert.equal(r.processed, 1);
    const after = db.prepare(`SELECT behavior_state, mount_state FROM player_companions WHERE id = ?`).get('m3');
    assert.equal(after.behavior_state, 'feeding');
    const st = JSON.parse(after.mount_state);
    assert.ok(st.hunger < 80, 'hunger decremented while feeding');
  });

  it("counts state changes correctly", async () => {
    const db = fresh();
    db.prepare(`INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible, deployed, mount_state, pos_x, pos_z, behavior_state) VALUES (?, ?, ?, ?, ?, 1, 0, '{}', 0, 0, 'feeding')`)
      .run('m4', 'u1', 'crt4', 'Bay', 'concordia-hub');
    const r = await runMountBehaviorCycle({ db });
    assert.equal(r.stateChanges, 1, 'feeding → wandering counted');
  });
});
