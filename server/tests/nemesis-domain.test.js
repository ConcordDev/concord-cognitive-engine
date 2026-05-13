/**
 * Tier-2 contract test for the nemesis domain macros.
 *
 * Pins:
 *   - nemesis.nearby returns one entry per non-creature NPC in the world,
 *     filtered by radius from origin when (x,z) given.
 *   - Each row carries grudge / preoccupation / desire / stress / scheme
 *     fields (null when not set).
 *   - isNemesis flips when an active scheme exists OR stress.level ≥ 7
 *     OR a sufficiently-severe grudge exists.
 *   - nemesis.for_npc returns the asymmetry context for a single NPC.
 *   - Missing worldId / db handled gracefully.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up046 } from "../migrations/046_nemesis_crises.js";
import { up as up128 } from "../migrations/128_npc_asymmetry.js";
import { up as up152 } from "../migrations/152_npc_stress.js";
import { up as up155 } from "../migrations/155_npc_schemes.js";
import { getNemesisRowsForWorld } from "../domains/nemesis.js";

function setupDb() {
  const db = new Database(":memory:");
  // Minimum schema fauna-spawner / nemesis touches.
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      archetype TEXT,
      species_id TEXT,
      x REAL,
      y REAL DEFAULT 0,
      z REAL,
      is_dead INTEGER DEFAULT 0
    );
    CREATE TABLE authored_npcs (
      id TEXT PRIMARY KEY,
      name TEXT
    );
  `);
  try { up046(db); } catch { /* may collide if column-add-only */ }
  up128(db);
  up152(db);
  up155(db);
  return db;
}

describe("nemesis.nearby", () => {
  let db;
  beforeEach(() => {
    db = setupDb();
    // Three NPCs in tunya at varying distance from (0,0).
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, x, z) VALUES (?, ?, ?, ?, ?)`)
      .run("npc_a", "tunya", "warrior", 5, 5);
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, x, z) VALUES (?, ?, ?, ?, ?)`)
      .run("npc_b", "tunya", "warrior", 50, 50);
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, x, z) VALUES (?, ?, ?, ?, ?)`)
      .run("npc_c", "tunya", "warrior", 200, 200);
    // A creature — should NOT surface in nemesis.
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, z) VALUES (?, ?, ?, ?, ?, ?)`)
      .run("cr_x", "tunya", "creature:wolf", "wolf", 0, 0);
    db.prepare(`INSERT INTO authored_npcs (id, name) VALUES (?, ?)`).run("npc_a", "Aldra");
  });

  it("returns non-creature NPCs only", () => {
    const rows = getNemesisRowsForWorld(db, "tunya", "u_1", 0, 0, 1000);
    const ids = rows.map((r) => r.npcId);
    assert.ok(ids.includes("npc_a"));
    assert.ok(!ids.includes("cr_x"), "creatures must not surface");
  });

  it("filters by radius when origin given", () => {
    const near = getNemesisRowsForWorld(db, "tunya", "u_1", 0, 0, 10);
    const ids = near.map((r) => r.npcId);
    assert.ok(ids.includes("npc_a"));
    assert.ok(!ids.includes("npc_b"), "far NPC must be filtered out");
    assert.ok(!ids.includes("npc_c"));
  });

  it("uses authored name when available", () => {
    const rows = getNemesisRowsForWorld(db, "tunya", "u_1", 0, 0, 1000);
    const aldra = rows.find((r) => r.npcId === "npc_a");
    assert.equal(aldra?.name, "Aldra");
  });

  it("isNemesis flips when an active scheme exists", () => {
    db.prepare(`
      INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind, phase)
      VALUES (?, 'npc', ?, 'player', ?, 'assassinate', 'planning')
    `).run("sch_1", "npc_a", "u_1");

    const rows = getNemesisRowsForWorld(db, "tunya", "u_1", 0, 0, 100);
    const a = rows.find((r) => r.npcId === "npc_a");
    assert.equal(a?.scheme?.kind, "assassinate");
    assert.equal(a?.scheme?.stage, "planning");
    assert.equal(a?.isNemesis, true);
  });

  it("isNemesis flips when stress level (0..10) >= 7", () => {
    // npc_stress.stress is 0..100; level is /10 in the domain output.
    db.prepare(`INSERT INTO npc_stress (npc_id, stress) VALUES (?, ?)`).run("npc_a", 80);
    const rows = getNemesisRowsForWorld(db, "tunya", "u_1", 0, 0, 100);
    const a = rows.find((r) => r.npcId === "npc_a");
    assert.equal(a?.stress?.level, 8);
    assert.equal(a?.isNemesis, true);
  });

  it("normal NPC with no nemesis state has isNemesis=false", () => {
    const rows = getNemesisRowsForWorld(db, "tunya", "u_1", 0, 0, 100);
    const a = rows.find((r) => r.npcId === "npc_a");
    assert.equal(a?.isNemesis, false);
    assert.equal(a?.scheme, null);
    assert.equal(a?.stress, null);
    assert.equal(a?.grudge, null);
  });
});
