/**
 * Migration 098 regression test — concordia-hub id reconciliation.
 *
 * Migration 098 backfills any row that still carries the old `world_id =
 * 'concordia'` to `'concordia-hub'` across 12 tables. This test seeds the
 * dirty rows, runs migration 098, and asserts the reconciliation
 * actually happened.
 *
 * Why it matters: a missed reconciliation row creates a phantom-world
 * data leak — queries scoped to `concordia-hub` won't see the row, but
 * any code path that still touches `world_id = 'concordia'` will. Real
 * symptom: NPCs / events / DTUs that "vanish" from the active world
 * after deploy.
 *
 * Run: node --test tests/migrations/098-hub-id-reconciliation.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig098 from "../../migrations/098_concordia_hub_id_reconciliation.js";

// The 12 tables migration 098 touches. We don't run migrations 001–097
// against the test DB — that would couple this test to the rest of the
// schema. Instead we synthesize each table with the minimum schema 098
// needs (just `world_id TEXT`) so we can verify the reconciliation logic
// in isolation.
const TABLES = [
  "world_npcs",
  "world_resource_nodes",
  "world_buildings",
  "creature_population",
  "creature_corpses",
  "npc_knowledge",
  "player_world_metrics",
  "world_events",
  "world_lore",
  "concord_link_walkers",
  "world_persistence",
  "dtus",
];

let db;
beforeEach(() => {
  db = new Database(":memory:");
  for (const t of TABLES) {
    db.exec(`CREATE TABLE ${t} (id TEXT PRIMARY KEY, world_id TEXT)`);
  }
});
afterEach(() => { try { db?.close(); } catch (_) { /* intentional */ } });

function seed(table, ids, worldId) {
  const stmt = db.prepare(`INSERT INTO ${table} (id, world_id) VALUES (?, ?)`);
  for (const id of ids) stmt.run(id, worldId);
}

function countWorld(table, worldId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE world_id = ?`).get(worldId).n;
}

describe("migration 098 — every affected table reconciles 'concordia' → 'concordia-hub'", () => {
  it("world_npcs: 3 dirty + 1 clean → 4 hub rows, 0 'concordia' rows", () => {
    seed("world_npcs", ["n1", "n2", "n3"], "concordia");
    seed("world_npcs", ["n4"], "concordia-hub");

    mig098.up(db);

    assert.equal(countWorld("world_npcs", "concordia"), 0);
    assert.equal(countWorld("world_npcs", "concordia-hub"), 4);
  });

  it("dtus: dirty rows are reconciled", () => {
    seed("dtus", ["d1", "d2"], "concordia");
    mig098.up(db);
    assert.equal(countWorld("dtus", "concordia"), 0);
    assert.equal(countWorld("dtus", "concordia-hub"), 2);
  });

  it("world_events: dirty rows are reconciled", () => {
    seed("world_events", ["e1", "e2", "e3"], "concordia");
    mig098.up(db);
    assert.equal(countWorld("world_events", "concordia"), 0);
    assert.equal(countWorld("world_events", "concordia-hub"), 3);
  });

  it("creature_population: dirty rows are reconciled", () => {
    seed("creature_population", ["c1"], "concordia");
    seed("creature_population", ["c2"], "concordia-hub");
    seed("creature_population", ["c3"], "fantasy"); // unrelated world — must NOT be touched
    mig098.up(db);
    assert.equal(countWorld("creature_population", "concordia"), 0);
    assert.equal(countWorld("creature_population", "concordia-hub"), 2);
    assert.equal(countWorld("creature_population", "fantasy"), 1);
  });

  it("every table in the migration's TABLES_WITH_WORLD_ID list reconciles", () => {
    for (const t of TABLES) {
      seed(t, [`row_${t}_1`, `row_${t}_2`], "concordia");
    }
    mig098.up(db);
    for (const t of TABLES) {
      assert.equal(
        countWorld(t, "concordia"), 0,
        `${t} still has 'concordia' rows after migration 098`,
      );
      assert.equal(
        countWorld(t, "concordia-hub"), 2,
        `${t} should have 2 'concordia-hub' rows after migration 098`,
      );
    }
  });
});

describe("migration 098 — partial-deployment safety", () => {
  it("skips tables that don't have a world_id column", () => {
    // Drop world_id from one table and add a different schema. Migration
    // must not crash; it must skip the table cleanly.
    db.exec(`DROP TABLE world_npcs`);
    db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, name TEXT)`);
    db.prepare(`INSERT INTO world_npcs (id, name) VALUES (?, ?)`).run("n1", "Test");

    // Should not throw
    assert.doesNotThrow(() => mig098.up(db));

    // The malformed table is untouched
    const row = db.prepare(`SELECT id, name FROM world_npcs WHERE id = ?`).get("n1");
    assert.equal(row.name, "Test");
  });

  it("skips tables that don't exist at all", () => {
    db.exec(`DROP TABLE world_npcs`);
    // Migration must tolerate missing tables (per its `try/catch`)
    assert.doesNotThrow(() => mig098.up(db));
  });
});

describe("migration 098 — idempotency", () => {
  it("running twice produces the same final state", () => {
    seed("world_npcs", ["n1", "n2"], "concordia");
    mig098.up(db);
    mig098.up(db); // should be a no-op the second time
    assert.equal(countWorld("world_npcs", "concordia"), 0);
    assert.equal(countWorld("world_npcs", "concordia-hub"), 2);
  });

  it("does not touch already-correct rows", () => {
    seed("world_npcs", ["n1"], "concordia-hub");
    mig098.up(db);
    assert.equal(countWorld("world_npcs", "concordia-hub"), 1);
  });

  it("does not touch unrelated worlds (superhero, fantasy, crime, cyber)", () => {
    seed("world_npcs", ["n1"], "superhero");
    seed("world_npcs", ["n2"], "fantasy");
    seed("world_npcs", ["n3"], "crime");
    seed("world_npcs", ["n4"], "cyber");
    seed("world_npcs", ["n5"], "concordia"); // only this should change

    mig098.up(db);

    assert.equal(countWorld("world_npcs", "superhero"), 1);
    assert.equal(countWorld("world_npcs", "fantasy"), 1);
    assert.equal(countWorld("world_npcs", "crime"), 1);
    assert.equal(countWorld("world_npcs", "cyber"), 1);
    assert.equal(countWorld("world_npcs", "concordia"), 0);
    assert.equal(countWorld("world_npcs", "concordia-hub"), 1);
  });
});
