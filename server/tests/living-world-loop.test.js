/**
 * WS7 capstone — the living-world loop end to end.
 *
 * Proves the core promise: as entities level up, the migration engine drains the
 * strong toward the frontier while the hub stays low-level and grindable, the
 * spawner refills the emptied hub with fresh weak creatures, and the
 * gradient-health telemetry reports a healthy world.
 *
 * Exercises WS0 (gradient) + WS1 (combat level read) + WS2 (place-based spawn) +
 * WS3 (outward migration) + WS7 (health).
 * Run: node --test tests/living-world-loop.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import { runFaunaSpawner } from "../lib/ecosystem/fauna-spawner.js";
import { runWorldMigrationCycle } from "../emergent/world-migration-cycle.js";
import { worldGradientHealth } from "../lib/world-gradient-health.js";
import { gradientConfigFor, hubAnchorFor, distanceFromHub, dangerBandAt } from "../lib/world-gradient.js";

const GRAD = { worldRadiusM: 800, hubRadiusM: 80, bandCount: 6, frontierLevel: 100 };

function setup() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, species_id TEXT,
      x REAL, y REAL, z REAL, is_dead INTEGER DEFAULT 0, is_immortal INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1, current_location TEXT
    );
    CREATE TABLE creature_population (
      id TEXT PRIMARY KEY, world_id TEXT, biome TEXT, species_id TEXT,
      target_count INTEGER, current_count INTEGER, lifestyle TEXT, last_tick_at INTEGER
    );
    CREATE TABLE worlds (id TEXT PRIMARY KEY, universe_type TEXT, rule_modulators TEXT);
    CREATE TABLE world_zones (
      id TEXT PRIMARY KEY, world_id TEXT, name TEXT, kind TEXT,
      center_x REAL, center_z REAL, radius_m REAL
    );
    CREATE TABLE world_visits (world_id TEXT, departed_at INTEGER);
  `);
  db.prepare("INSERT INTO worlds (id, universe_type, rule_modulators) VALUES ('w1','standard',?)")
    .run(JSON.stringify({ gradient: GRAD }));
  db.prepare("INSERT INTO world_zones (id, world_id, name, kind, center_x, center_z, radius_m) VALUES ('z','w1','Domain','sanctuary',0,0,80)").run();
  db.prepare("INSERT INTO world_visits (world_id, departed_at) VALUES ('w1', NULL)").run();
  db.prepare("INSERT INTO world_npcs (id, world_id, archetype, x, y, z, level) VALUES ('seed','w1','villager',0,0,0,1)").run();
  return db;
}

const cfg = gradientConfigFor({ rule_modulators: JSON.stringify({ gradient: GRAD }) });

describe("living-world loop (capstone)", () => {
  beforeEach(() => { process.env.CONCORD_RADIAL_WORLDS = "1"; });
  afterEach(() => { delete process.env.CONCORD_RADIAL_WORLDS; });

  it("veterans migrate out, the hub stays grindable, the spawner refills it", async () => {
    const db = setup();
    const anchor = hubAnchorFor(db, "w1", cfg);

    // 10 fresh weak townsfolk + 5 veterans who leveled up IN the hub ring.
    for (let i = 0; i < 10; i++) {
      db.prepare("INSERT INTO world_npcs (id, world_id, archetype, x, z, level) VALUES (?,?, 'villager', ?, 0, 2)")
        .run(`weak${i}`, "w1", 60 + i); // dist ~60-70 (inside hub band)
    }
    for (let i = 0; i < 5; i++) {
      db.prepare("INSERT INTO world_npcs (id, world_id, archetype, x, z, level) VALUES (?,?, 'bandit', ?, 0, 90)")
        .run(`vet${i}`, "w1", 100 + i); // dist ~100, but level 90 belongs near the frontier
    }
    const vetStart = db.prepare("SELECT id, x FROM world_npcs WHERE id LIKE 'vet%'").all();

    // Run the migration cycle enough passes for the veterans to reach their band.
    for (let pass = 0; pass < 20; pass++) await runWorldMigrationCycle({ db });

    // Veterans have drifted outward into a high danger band; townsfolk stayed put.
    for (const v of vetStart) {
      const now = db.prepare("SELECT x, z FROM world_npcs WHERE id = ?").get(v.id);
      const d = distanceFromHub(anchor, now.x, now.z);
      assert.ok(d > 400, `veteran ${v.id} should have migrated outward (dist ${Math.round(d)})`);
      assert.ok(dangerBandAt(cfg, anchor, now.x, now.z) >= 3, `veteran should sit in an outer band`);
    }
    for (let i = 0; i < 10; i++) {
      const w = db.prepare("SELECT x FROM world_npcs WHERE id = ?").get(`weak${i}`);
      assert.ok(distanceFromHub(anchor, w.x, 0) < 120, "weak townsfolk stay near the hub");
    }

    // The spawner refills the hub with fresh WEAK creatures.
    const r = runFaunaSpawner({ state: {}, db });
    assert.ok(r.ok && r.spawned > 0);
    const hubCreatures = db.prepare(`
      SELECT level, x, z FROM world_npcs WHERE archetype LIKE 'creature:%'
    `).all().filter((c) => distanceFromHub(anchor, c.x, c.z) <= anchor.radiusM + 60);
    assert.ok(hubCreatures.length > 0, "hub should have fresh creatures to grind");
    for (const c of hubCreatures) {
      assert.ok(c.level <= 12, `hub creatures stay low-level (got ${c.level})`);
    }

    // Telemetry agrees: hub low-level + veterans outward.
    const health = worldGradientHealth(db, "w1");
    assert.equal(health.health.hubLowLevel, true);
    assert.equal(health.health.veteransOutward, true);
    // The veterans (level 90) sit in a high band; some outer band (index ≥ 3)
    // now holds level-90+ entities, while the hub band stays low.
    const outerHoldsVets = health.bands.some((b) => b.band >= 3 && b.maxLevel >= 80);
    assert.ok(outerHoldsVets, "an outer band should hold the migrated veterans");
    assert.ok(health.bands[0].maxLevel <= 12, "hub band stays low-level");
  });
});
