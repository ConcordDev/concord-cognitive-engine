/**
 * WS3 — outward-migration engine tests.
 * Pins the pure drift/step math and the NPC re-anchor cycle: strong NPCs near
 * the hub step outward, weak NPCs and immortal anchors stay put, and the whole
 * thing is a no-op when radial worlds are off.
 * Run: node --test tests/world-migration.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import { gradientConfigFor, hubAnchorFor, distanceFromHub } from "../lib/world-gradient.js";
import {
  homeInnerRadius, radiusDeficit, outwardDriftForce, migrationStep,
} from "../lib/world-migration.js";
import { runWorldMigrationCycle } from "../emergent/world-migration-cycle.js";

const GRAD = { worldRadiusM: 800, hubRadiusM: 80, bandCount: 6, frontierLevel: 100 };
const cfg = gradientConfigFor({ rule_modulators: JSON.stringify({ gradient: GRAD }) });
const anchor = { x: 0, z: 0, radiusM: 80 };

describe("world-migration math", () => {
  it("home inner radius grows with level", () => {
    assert.ok(homeInnerRadius(cfg, 90) > homeInnerRadius(cfg, 30));
    assert.ok(homeInnerRadius(cfg, 1) <= cfg.hubRadiusM + 1);
  });

  it("drift force is zero past the home band, outward when inside", () => {
    // level 90 belongs near the frontier; at (100,0) it's deep inside its band.
    const inside = outwardDriftForce(cfg, anchor, 100, 0, 90);
    assert.ok(inside.fx > 0 && Math.abs(inside.fz) < 1e-9, "should push +x (outward)");
    // a level-1 entity at the same spot is already at/beyond its band → no drift
    const settled = outwardDriftForce(cfg, anchor, 100, 0, 1);
    assert.equal(settled.fx, 0);
    assert.equal(settled.fz, 0);
  });

  it("migration step moves outward and stops on arrival", () => {
    const next = migrationStep(cfg, anchor, 100, 0, 90, 40);
    assert.ok(next && next.x > 100, "step should increase distance from hub");
    assert.ok(distanceFromHub(anchor, next.x, next.z) <= homeInnerRadius(cfg, 90));
    // already at the frontier → null (no write needed)
    assert.equal(migrationStep(cfg, anchor, 790, 0, 90, 40), null);
    assert.ok(radiusDeficit(cfg, anchor, 790, 0, 90) <= 8);
  });
});

function setupCycleDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, x REAL, z REAL,
      level INTEGER DEFAULT 1, is_dead INTEGER DEFAULT 0, is_immortal INTEGER DEFAULT 0,
      current_location TEXT
    );
    CREATE TABLE worlds (id TEXT PRIMARY KEY, rule_modulators TEXT);
    CREATE TABLE world_zones (
      id TEXT PRIMARY KEY, world_id TEXT, name TEXT, kind TEXT,
      center_x REAL, center_z REAL, radius_m REAL
    );
    CREATE TABLE world_visits (world_id TEXT, departed_at INTEGER);
  `);
  db.prepare("INSERT INTO worlds (id, rule_modulators) VALUES ('w1', ?)")
    .run(JSON.stringify({ gradient: GRAD }));
  db.prepare("INSERT INTO world_zones (id, world_id, name, kind, center_x, center_z, radius_m) VALUES ('z','w1','Domain','sanctuary',0,0,80)").run();
  db.prepare("INSERT INTO world_visits (world_id, departed_at) VALUES ('w1', NULL)").run();
  // strong NPC near the hub (should migrate), weak NPC (should stay),
  // immortal strong anchor (should stay).
  db.prepare("INSERT INTO world_npcs (id, world_id, archetype, x, z, level, is_immortal) VALUES ('strong','w1','bandit',100,0,90,0)").run();
  db.prepare("INSERT INTO world_npcs (id, world_id, archetype, x, z, level, is_immortal) VALUES ('weak','w1','villager',100,0,2,0)").run();
  db.prepare("INSERT INTO world_npcs (id, world_id, archetype, x, z, level, is_immortal) VALUES ('king','w1','sovereign',100,0,9000,1)").run();
  // a creature — must be ignored (creatures drift via the flock cycle)
  db.prepare("INSERT INTO world_npcs (id, world_id, archetype, x, z, level) VALUES ('beast','w1','creature:wolf',100,0,90)").run();
  return db;
}

describe("world-migration-cycle (NPC re-anchor)", () => {
  beforeEach(() => { process.env.CONCORD_RADIAL_WORLDS = "1"; });
  afterEach(() => { delete process.env.CONCORD_RADIAL_WORLDS; delete process.env.CONCORD_WORLD_MIGRATION; });

  it("steps strong NPCs outward, leaves weak/immortal/creatures alone", async () => {
    const db = setupCycleDb();
    const strongBefore = db.prepare("SELECT x FROM world_npcs WHERE id='strong'").get().x;
    const r = await runWorldMigrationCycle({ db });
    assert.ok(r.ok);
    assert.ok(r.totalMoved >= 1);
    assert.ok(db.prepare("SELECT x FROM world_npcs WHERE id='strong'").get().x > strongBefore, "strong NPC moved outward");
    assert.equal(db.prepare("SELECT x FROM world_npcs WHERE id='weak'").get().x, 100, "weak NPC stayed");
    assert.equal(db.prepare("SELECT x FROM world_npcs WHERE id='king'").get().x, 100, "immortal anchor stayed");
    assert.equal(db.prepare("SELECT x FROM world_npcs WHERE id='beast'").get().x, 100, "creature untouched by this cycle");
    // current_location kept in sync for the strong NPC
    const loc = JSON.parse(db.prepare("SELECT current_location FROM world_npcs WHERE id='strong'").get().current_location);
    assert.ok(loc.x > 100);
  });

  it("is a no-op when radial worlds are off", async () => {
    delete process.env.CONCORD_RADIAL_WORLDS;
    const db = setupCycleDb();
    const r = await runWorldMigrationCycle({ db });
    assert.equal(r.reason, "radial_worlds_off");
    assert.equal(db.prepare("SELECT x FROM world_npcs WHERE id='strong'").get().x, 100);
  });

  it("respects the hard kill-switch", async () => {
    process.env.CONCORD_WORLD_MIGRATION = "0";
    const db = setupCycleDb();
    const r = await runWorldMigrationCycle({ db });
    assert.equal(r.reason, "disabled");
  });
});
