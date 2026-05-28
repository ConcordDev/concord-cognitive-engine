// Phase CA2 — submarine dive-state aggregator tests.
//
// We don't load server.js here (its boot is heavy). Instead the test
// reads the same tables the route reads and validates the join shape
// directly via better-sqlite3.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upOxygen } from "../migrations/157_player_oxygen.js";

function freshDb() {
  const db = new Database(":memory:");
  upOxygen(db);
  db.exec(`
    CREATE TABLE world_visits (
      user_id TEXT,
      world_id TEXT,
      entered_at INTEGER,
      departed_at INTEGER,
      is_swimming INTEGER DEFAULT 0,
      swim_depth REAL DEFAULT 0,
      last_position TEXT DEFAULT '{}'
    );
    CREATE TABLE creature_swim_depth (
      id TEXT PRIMARY KEY,
      world_id TEXT,
      species_id TEXT,
      current_depth REAL,
      x REAL,
      z REAL
    );
  `);
  return db;
}

describe("Phase CA2 — dive-state shape", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("returns isSwimming:false when player has no active visit", () => {
    const v = db.prepare(`
      SELECT world_id, is_swimming FROM world_visits
      WHERE user_id = ? AND departed_at IS NULL
      ORDER BY entered_at DESC LIMIT 1
    `).get("u1");
    assert.equal(v, undefined);
  });

  it("joins oxygen_pct + max_depth_explored when present", () => {
    db.prepare(`INSERT INTO world_visits VALUES ('u1', 'tunya', unixepoch(), NULL, 1, 6.5, '{"x":10,"z":20}')`).run();
    db.prepare(`INSERT INTO player_oxygen (user_id, world_id, oxygen_pct, max_depth_explored, drowning_damage) VALUES ('u1', 'tunya', 72.5, 8, 0)`).run();
    const visit = db.prepare(`SELECT swim_depth, is_swimming FROM world_visits WHERE user_id = ?`).get("u1");
    const ox = db.prepare(`SELECT oxygen_pct, max_depth_explored FROM player_oxygen WHERE user_id = ?`).get("u1");
    assert.equal(visit.is_swimming, 1);
    assert.equal(visit.swim_depth, 6.5);
    assert.equal(ox.oxygen_pct, 72.5);
    assert.equal(ox.max_depth_explored, 8);
  });

  it("sonar contacts: creatures within 8m of player depth + 80m horizontal", () => {
    db.prepare(`INSERT INTO world_visits VALUES ('u1', 'tunya', unixepoch(), NULL, 1, 10, '{"x":0,"z":0}')`).run();
    // Near: same depth ±4, within 80m horizontal.
    db.prepare(`INSERT INTO creature_swim_depth VALUES ('c1', 'tunya', 'reef_eel', 12, 30, 30)`).run();
    // Out of horizontal range.
    db.prepare(`INSERT INTO creature_swim_depth VALUES ('c2', 'tunya', 'crab', 10, 200, 0)`).run();
    // Out of depth range.
    db.prepare(`INSERT INTO creature_swim_depth VALUES ('c3', 'tunya', 'deepfish', 80, 5, 5)`).run();

    const playerDepth = 10;
    const rows = db.prepare(`
      SELECT id, species_id AS speciesId, current_depth AS depth, x, z
      FROM creature_swim_depth WHERE world_id = ? AND ABS(current_depth - ?) < 8
    `).all("tunya", playerDepth);
    const filtered = rows
      .map(r => ({ ...r, distance: Math.hypot(r.x, r.z) }))
      .filter(c => c.distance < 80);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].speciesId, "reef_eel");
  });
});
