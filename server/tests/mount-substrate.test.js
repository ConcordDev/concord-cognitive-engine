/**
 * Tier-2 contract tests for Concordia Procedural Mount System Phase B1.
 *
 * Pinned:
 *   - migration 142 applies (mount_species, mount_gait_profiles,
 *     mounted_instances, ALTER on player_companions)
 *   - size_class CHECK enforces enum
 *   - seedMountSpecies is idempotent (INSERT OR IGNORE)
 *   - isSpeciesMountable / getMountSpecies / getGaitProfile read paths
 *   - markCompanionMountable + isCompanionMountable
 *   - listMountableCompanionsForOwner respects world scoping
 *   - 8 starter species seeded with valid gait profiles
 *
 * Run: node --test tests/mount-substrate.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig104 from "../migrations/104_player_companions.js";
import * as mig142 from "../migrations/142_mount_substrate.js";
import {
  isSpeciesMountable,
  listMountableSpecies,
  getMountSpecies,
  getGaitProfile,
  markCompanionMountable,
  isCompanionMountable,
  listMountableCompanionsForOwner,
} from "../lib/ecosystem/mount-eligibility.js";
import { seedMountSpecies } from "../lib/ecosystem/mount-species-seeder.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  // Minimal world_npcs table for the proximity tests below.
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      archetype TEXT NOT NULL,
      name TEXT,
      x REAL, y REAL, z REAL,
      level INTEGER DEFAULT 1,
      is_dead INTEGER DEFAULT 0,
      is_conscious INTEGER DEFAULT 0,
      is_immortal INTEGER DEFAULT 0
    );
  `);
  mig104.up(db);
  mig142.up(db);
});

afterEach(() => { try { db?.close(); } catch { /* intentional */ } });

describe("migration 142 — mount substrate", () => {
  it("creates mount_species with size_class CHECK", () => {
    const cols = db.prepare("PRAGMA table_info(mount_species)").all().map(c => c.name);
    for (const k of ["species_id", "size_class", "base_speed_mps", "carry_capacity_kg", "flight_capable"]) {
      assert.ok(cols.includes(k), `mount_species missing column ${k}`);
    }
    assert.throws(() => {
      db.prepare(`INSERT INTO mount_species (species_id, display_name, size_class, base_speed_mps, base_stamina, carry_capacity_kg) VALUES ('x', 'X', 'gigantic', 5, 10, 10)`).run();
    }, /CHECK/);
  });

  it("creates mount_gait_profiles + mounted_instances", () => {
    const tg = db.prepare("PRAGMA table_info(mount_gait_profiles)").all().map(c => c.name);
    assert.ok(tg.includes("walk_cycle_json"));
    assert.ok(tg.includes("trot_cycle_json"));
    assert.ok(tg.includes("gallop_cycle_json"));

    const tm = db.prepare("PRAGMA table_info(mounted_instances)").all().map(c => c.name);
    assert.ok(tm.includes("rider_id"));
    assert.ok(tm.includes("mount_companion_id"));
    assert.ok(tm.includes("dismounted_at"));
  });

  it("ALTER player_companions adds mount_eligible + mount_state", () => {
    const cols = db.prepare("PRAGMA table_info(player_companions)").all().map(c => c.name);
    assert.ok(cols.includes("mount_eligible"));
    assert.ok(cols.includes("mount_state"));
  });

  it("ALTER is idempotent on re-run (no throw)", () => {
    let threw = false;
    try { mig142.up(db); } catch { threw = true; }
    assert.equal(threw, false);
  });

  it("flight_capable CHECK rejects values outside 0/1", () => {
    assert.throws(() => {
      db.prepare(`INSERT INTO mount_species
        (species_id, display_name, size_class, base_speed_mps, base_stamina, carry_capacity_kg, flight_capable)
        VALUES ('x', 'X', 'large', 5, 10, 10, 7)`).run();
    }, /CHECK/);
  });
});

describe("seedMountSpecies", () => {
  it("seeds 8 species with gait profiles on first call", () => {
    const r = seedMountSpecies(db);
    assert.equal(r.ok, true);
    assert.equal(r.total, 8);
    assert.equal(r.inserted.species, 8);
    assert.equal(r.inserted.gaits, 8);

    const speciesCount = db.prepare(`SELECT COUNT(*) AS n FROM mount_species`).get().n;
    const gaitCount = db.prepare(`SELECT COUNT(*) AS n FROM mount_gait_profiles`).get().n;
    assert.equal(speciesCount, 8);
    assert.equal(gaitCount, 8);
  });

  it("is idempotent — second call inserts 0 rows", () => {
    seedMountSpecies(db);
    const r = seedMountSpecies(db);
    assert.equal(r.ok, true);
    assert.equal(r.inserted.species, 0);
    assert.equal(r.inserted.gaits, 0);
  });

  it("seeds expected starter set", () => {
    seedMountSpecies(db);
    const ids = db.prepare(`SELECT species_id FROM mount_species ORDER BY species_id`).all().map(r => r.species_id);
    for (const expected of ["warhorse", "dire_wolf", "chimera", "giant_elk", "salamander_mount", "hippogriff", "gryphon", "juvenile_wyvern"]) {
      assert.ok(ids.includes(expected), `missing seeded species ${expected}`);
    }
  });

  it("seeds flight-capable set correctly", () => {
    seedMountSpecies(db);
    const flying = db.prepare(`SELECT species_id FROM mount_species WHERE flight_capable = 1 ORDER BY species_id`).all().map(r => r.species_id);
    assert.deepEqual(flying.sort(), ["gryphon", "hippogriff", "juvenile_wyvern"]);
  });

  it("returns ok:false when db is missing", () => {
    const r = seedMountSpecies(null);
    assert.equal(r.ok, false);
  });
});

describe("isSpeciesMountable + getMountSpecies + getGaitProfile", () => {
  beforeEach(() => seedMountSpecies(db));

  it("isSpeciesMountable returns true for seeded species", () => {
    assert.equal(isSpeciesMountable(db, "warhorse"), true);
    assert.equal(isSpeciesMountable(db, "chimera"), true);
  });

  it("isSpeciesMountable returns false for unknown species", () => {
    assert.equal(isSpeciesMountable(db, "rabbit"), false);
    assert.equal(isSpeciesMountable(db, ""), false);
    assert.equal(isSpeciesMountable(db, null), false);
  });

  it("getMountSpecies returns full record with parsed JSON", () => {
    const sp = getMountSpecies(db, "warhorse");
    assert.ok(sp);
    assert.equal(sp.speciesId, "warhorse");
    assert.equal(sp.sizeClass, "large");
    assert.equal(sp.flightCapable, false);
    assert.ok(sp.riderSeatOffset);
    assert.equal(typeof sp.riderSeatOffset.y, "number");
    assert.ok(Array.isArray(sp.aestheticTags));
  });

  it("getGaitProfile returns parsed cycle blocks", () => {
    const g = getGaitProfile(db, "warhorse");
    assert.ok(g);
    assert.equal(g.speciesId, "warhorse");
    assert.ok(g.walk?.phase_offsets);
    assert.equal(g.walk.phase_offsets.length, 4);
    assert.ok(g.trot?.stride_m);
    assert.ok(g.gallop?.stride_m);
    assert.ok(g.turnRadiusM > 0);
  });

  it("returns null for unknown species lookups", () => {
    assert.equal(getMountSpecies(db, "ghost"), null);
    assert.equal(getGaitProfile(db, "ghost"), null);
  });
});

describe("markCompanionMountable + isCompanionMountable", () => {
  beforeEach(() => seedMountSpecies(db));

  it("returns species_not_mountable for unknown species", () => {
    db.prepare(`
      INSERT INTO player_companions (id, owner_id, creature_id, name, world_id)
      VALUES ('c1', 'alice', 'crX', 'Spot', 'concordia-hub')
    `).run();
    const r = markCompanionMountable(db, "c1", "rabbit");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "species_not_mountable");
    assert.equal(isCompanionMountable(db, "c1"), false);
  });

  it("flips mount_eligible to 1 for a mountable species", () => {
    db.prepare(`
      INSERT INTO player_companions (id, owner_id, creature_id, name, world_id)
      VALUES ('c2', 'alice', 'crY', 'Thunder', 'concordia-hub')
    `).run();
    const r = markCompanionMountable(db, "c2", "warhorse");
    assert.equal(r.ok, true);
    assert.equal(r.changed, 1);
    assert.equal(isCompanionMountable(db, "c2"), true);
  });

  it("is idempotent — running on already-eligible row is a no-op", () => {
    db.prepare(`
      INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible)
      VALUES ('c3', 'alice', 'crZ', 'Storm', 'concordia-hub', 1)
    `).run();
    const r = markCompanionMountable(db, "c3", "warhorse");
    assert.equal(r.ok, true);
    assert.equal(r.changed, 0);
  });
});

describe("listMountableCompanionsForOwner", () => {
  beforeEach(() => {
    seedMountSpecies(db);
    db.prepare(`INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible) VALUES ('a', 'alice', 'cA', 'A', 'concordia-hub', 1)`).run();
    db.prepare(`INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible) VALUES ('b', 'alice', 'cB', 'B', 'concordia-hub', 0)`).run();
    db.prepare(`INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible) VALUES ('c', 'alice', 'cC', 'C', 'other-world', 1)`).run();
    db.prepare(`INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible) VALUES ('d', 'bob',   'cD', 'D', 'concordia-hub', 1)`).run();
  });

  it("returns only mount_eligible=1 rows for the owner", () => {
    const list = listMountableCompanionsForOwner(db, "alice");
    const ids = list.map(r => r.id).sort();
    assert.deepEqual(ids, ["a", "c"]);
  });

  it("filters by world when worldId given", () => {
    const list = listMountableCompanionsForOwner(db, "alice", "concordia-hub");
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "a");
  });

  it("returns empty for unknown owner", () => {
    const list = listMountableCompanionsForOwner(db, "ghost");
    assert.equal(list.length, 0);
  });
});

describe("listMountableSpecies ordering", () => {
  beforeEach(() => seedMountSpecies(db));

  it("orders by size_class then base_speed_mps DESC", () => {
    const list = listMountableSpecies(db);
    assert.equal(list.length, 8);
    // Within same size_class, faster should come first.
    const huges = list.filter(s => s.sizeClass === "huge");
    assert.ok(huges.length >= 2);
    for (let i = 1; i < huges.length; i++) {
      assert.ok(huges[i - 1].baseSpeedMps >= huges[i].baseSpeedMps);
    }
  });
});
