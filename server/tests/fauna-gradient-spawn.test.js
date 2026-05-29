/**
 * WS2 — place-based spawning contract test.
 * Runs the fauna spawner in radial mode and asserts every spawned creature's
 * level falls in the danger-band window for its actual spawn position (dense
 * weak near the hub, strong toward the frontier), and that the gradient yields
 * a spread of levels rather than a flat level-1 population.
 * Run: node --test tests/fauna-gradient-spawn.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import { runFaunaSpawner } from "../lib/ecosystem/fauna-spawner.js";
import {
  gradientConfigFor, hubAnchorFor, dangerBandAt, bandLevelRange, distanceFromHub,
} from "../lib/world-gradient.js";

const COMPACT_GRADIENT = { worldRadiusM: 800, hubRadiusM: 80, bandCount: 6, frontierLevel: 100 };

function setup(gradientOverride = null) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, species_id TEXT,
      x REAL, y REAL, z REAL, is_dead INTEGER DEFAULT 0, level INTEGER DEFAULT 1
    );
    CREATE TABLE creature_population (
      id TEXT PRIMARY KEY, world_id TEXT, biome TEXT, species_id TEXT,
      target_count INTEGER, current_count INTEGER, lifestyle TEXT, last_tick_at INTEGER
    );
    CREATE TABLE worlds (id TEXT PRIMARY KEY, universe_type TEXT, rule_modulators TEXT);
    CREATE TABLE world_zones (
      id TEXT PRIMARY KEY, world_id TEXT, name TEXT, kind TEXT,
      center_x REAL, center_z REAL, radius_m REAL, rules_json TEXT, created_by TEXT
    );
  `);
  const rm = gradientOverride ? JSON.stringify({ gradient: gradientOverride }) : null;
  db.prepare("INSERT INTO worlds (id, universe_type, rule_modulators) VALUES ('w1','standard',?)").run(rm);
  db.prepare(`INSERT INTO world_zones (id, world_id, name, kind, center_x, center_z, radius_m)
              VALUES ('z1','w1','Domain','sanctuary',0,0,400)`).run();
  // Seed one alive NPC so the spawner discovers the world.
  db.prepare("INSERT INTO world_npcs (id, world_id, archetype, species_id, x, y, z, is_dead, level) VALUES ('seed','w1','villager',NULL,0,0,0,0,1)").run();
  return db;
}

describe("WS2 gradient spawning (radial)", () => {
  beforeEach(() => { process.env.CONCORD_RADIAL_WORLDS = "1"; });
  afterEach(() => { delete process.env.CONCORD_RADIAL_WORLDS; });

  it("assigns each creature a level inside its band window, with spread", () => {
    const db = setup(COMPACT_GRADIENT);
    const r = runFaunaSpawner({ state: {}, db });
    assert.ok(r.ok);
    assert.ok(r.spawned > 0, "spawner should have placed creatures");

    const creatures = db.prepare(
      "SELECT id, x, z, level FROM world_npcs WHERE archetype LIKE 'creature:%'"
    ).all();
    assert.ok(creatures.length > 0);

    const cfg = gradientConfigFor({ rule_modulators: JSON.stringify({ gradient: COMPACT_GRADIENT }) });
    const anchor = hubAnchorFor(db, "w1", cfg);

    const levels = new Set();
    for (const c of creatures) {
      const band = dangerBandAt(cfg, anchor, c.x, c.z);
      const [lo, hi] = bandLevelRange(cfg, band);
      assert.ok(
        c.level >= lo && c.level <= hi,
        `creature at dist ${Math.round(distanceFromHub(anchor, c.x, c.z))} band ${band} expected [${lo},${hi}] got ${c.level}`,
      );
      levels.add(c.level);
    }
    // The gradient should produce more than one distinct level across the map.
    assert.ok(levels.size > 1, "expected a spread of levels across danger bands");
  });

  it("legacy mode (flag off) keeps creatures near the hub at low level", () => {
    process.env.CONCORD_RADIAL_WORLDS = "0";
    const db = setup();
    const r = runFaunaSpawner({ state: {}, db });
    assert.ok(r.ok);
    const maxLevel = db.prepare(
      "SELECT MAX(level) AS m FROM world_npcs WHERE archetype LIKE 'creature:%'"
    ).get()?.m ?? 0;
    // ±400 legacy bounds sit well inside the hub/inner bands → low commons.
    assert.ok(maxLevel <= 20, `legacy spawns should stay low-level, got ${maxLevel}`);
  });
});
