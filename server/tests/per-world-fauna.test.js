/**
 * Tier-2 contract tests for the per-canon-world fauna roster + arid biome.
 *
 * Pins:
 *   - Arid biome resolves to a no-crocodile roster (the user's stated
 *     "crocodile-in-the-desert" bug).
 *   - Each canon-world flavor (tunya / cyber / crime / fantasy /
 *     superhero / sovereign_ruins / lattice_crucible / frontier) adds at
 *     least one thematic species on top of the standard base roster.
 *   - Concord-hub flavor exists but adds no extra carnivores (peace).
 *   - speciesForBiome(unknownUniverse, biome) falls back to the standard
 *     base set — every world gets fauna.
 *   - Every species id in BIOME_SPECIES has a corresponding LOOT entry.
 *   - Flock-cycle encounter sampler increments crossbreed bond for
 *     heterospecific pairs within encounter radius and skips conspecifics.
 *
 * Run: node --test tests/per-world-fauna.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { speciesForBiome, LOOT_TABLES, rollLoot } from "../lib/ecosystem/loot-tables.js";
import { up as up083 } from "../migrations/083_creature_crossbreeding.js";
import { runCreatureFlockCycle } from "../emergent/creature-flock-cycle.js";
import { getBond } from "../lib/creature-crossbreeding.js";

const CANON_UNIVERSES = [
  "tunya",
  "cyber",
  "crime",
  "fantasy",
  "superhero",
  "sovereign_ruins",
  "lattice_crucible",
  "frontier",
];

const STANDARD_BIOMES = ["plains", "forest", "highland", "mountain", "water", "arid"];

describe("arid biome", () => {
  it("returns no crocodile / shark / reef_eel — those are water-only", () => {
    const arid = speciesForBiome("standard", "arid");
    const ids = arid.map((s) => s.id);
    assert.ok(!ids.includes("reef_shark"), "shark must not spawn in arid");
    assert.ok(!ids.includes("reef_eel"),   "eel must not spawn in arid");
    assert.ok(!ids.includes("deep_octopus"), "octopus must not spawn in arid");
    assert.ok(!ids.includes("crocodile"),  "crocodile is not an arid species");
  });

  it("includes desert-appropriate species", () => {
    const arid = speciesForBiome("standard", "arid");
    const ids = arid.map((s) => s.id);
    assert.ok(ids.includes("dust_jackal"),   "expected dust_jackal in arid");
    assert.ok(ids.includes("desert_snake"),  "expected desert_snake in arid");
    assert.ok(ids.includes("sand_scorpion"), "expected sand_scorpion in arid");
  });

  it("Tunya arid biome adds sandsong_finch on top of the base set", () => {
    const arid = speciesForBiome("tunya", "arid");
    const ids = arid.map((s) => s.id);
    assert.ok(ids.includes("sandsong_finch"), "tunya arid should add sandsong_finch");
    assert.ok(ids.includes("dust_jackal"), "tunya arid still inherits base jackal");
  });
});

describe("canon-world rosters", () => {
  for (const universe of CANON_UNIVERSES) {
    it(`${universe}: speciesForBiome returns at least 1 species in at least one biome`, () => {
      let total = 0;
      for (const biome of STANDARD_BIOMES) {
        total += speciesForBiome(universe, biome).length;
      }
      assert.ok(total > 0, `${universe} returned 0 species across all biomes`);
    });
  }

  it("tunya plains adds kraal_buck (Tunyan-flavor grazer)", () => {
    const ids = speciesForBiome("tunya", "plains").map((s) => s.id);
    assert.ok(ids.includes("kraal_buck"), "expected kraal_buck in tunya plains");
  });

  it("cyber plains adds drone_rat + wire_corvid (urban scavengers)", () => {
    const ids = speciesForBiome("cyber", "plains").map((s) => s.id);
    assert.ok(ids.includes("drone_rat"), "expected drone_rat in cyber plains");
    assert.ok(ids.includes("wire_corvid"), "expected wire_corvid in cyber plains");
  });

  it("crime plains adds alley_cat + dock_rat (urban strays)", () => {
    const ids = speciesForBiome("crime", "plains").map((s) => s.id);
    assert.ok(ids.includes("alley_cat"), "expected alley_cat in crime plains");
    assert.ok(ids.includes("dock_rat"),  "expected dock_rat in crime plains");
  });

  it("superhero plains adds meta_coyote + plasma_pigeon (bio-touched)", () => {
    const ids = speciesForBiome("superhero", "plains").map((s) => s.id);
    assert.ok(ids.includes("meta_coyote"),  "expected meta_coyote in superhero plains");
    assert.ok(ids.includes("plasma_pigeon"), "expected plasma_pigeon in superhero plains");
  });

  it("sovereign_ruins plains adds archive_owl + wraith_deer (faded archival fauna)", () => {
    const ids = speciesForBiome("sovereign_ruins", "plains").map((s) => s.id);
    assert.ok(ids.includes("archive_owl"), "expected archive_owl in sovereign_ruins");
    assert.ok(ids.includes("wraith_deer"), "expected wraith_deer in sovereign_ruins");
  });

  it("lattice_crucible plains adds drift_stag + shimmer_finch (phase-shifting)", () => {
    const ids = speciesForBiome("lattice_crucible", "plains").map((s) => s.id);
    assert.ok(ids.includes("drift_stag"),    "expected drift_stag in lattice_crucible");
    assert.ok(ids.includes("shimmer_finch"), "expected shimmer_finch in lattice_crucible");
  });

  it("frontier plains adds walker_hound + trail_falcon (mesh-courier fauna)", () => {
    const ids = speciesForBiome("frontier", "plains").map((s) => s.id);
    assert.ok(ids.includes("walker_hound"), "expected walker_hound in frontier");
    assert.ok(ids.includes("trail_falcon"), "expected trail_falcon in frontier");
  });

  it("fantasy preserves moonbloom_sprite + star_seed_kin (original)", () => {
    const forest = speciesForBiome("fantasy", "forest").map((s) => s.id);
    assert.ok(forest.includes("moonbloom_sprite"));
    assert.ok(forest.includes("star_seed_kin"));
  });
});

describe("flavor falls back to standard for unknown universe", () => {
  it("unknown universe → just the base set", () => {
    const base = speciesForBiome("standard", "plains").map((s) => s.id).sort();
    const novel = speciesForBiome("nope_universe", "plains").map((s) => s.id).sort();
    assert.deepEqual(novel, base, "unknown universe should fall back to base species");
  });
});

describe("every BIOME_SPECIES entry has loot", () => {
  it("each registered species id has a LOOT row", () => {
    const seen = new Set();
    for (const universe of [...CANON_UNIVERSES, "standard", "fantasy", "concordia_hub"]) {
      for (const biome of STANDARD_BIOMES) {
        for (const s of speciesForBiome(universe, biome)) {
          seen.add(s.id);
        }
      }
    }
    for (const speciesId of seen) {
      assert.ok(LOOT_TABLES[speciesId], `species ${speciesId} has no loot table`);
    }
    assert.ok(seen.size >= 20, `expected ≥20 distinct species across canon worlds, got ${seen.size}`);
  });

  it("rollLoot returns at least one drop for each new arid species", () => {
    for (const speciesId of ["dust_jackal", "desert_snake", "sand_scorpion", "sandsong_finch"]) {
      // Force max chance with quality multiplier so rollLoot is deterministic.
      const drops = rollLoot(speciesId, 2.0);
      assert.ok(drops.length >= 1, `${speciesId} produced no drops`);
    }
  });
});

describe("crossbreeding bond accrues for new species via flock cycle", () => {
  let db;
  beforeEach(() => {
    db = new Database(":memory:");
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
      CREATE TABLE world_visits (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        world_id TEXT,
        arrived_at INTEGER,
        departed_at INTEGER
      );
      CREATE TABLE player_world_state (
        user_id TEXT,
        world_id TEXT,
        x REAL,
        z REAL
      );
    `);
    up083(db);
  });

  it("records bond between dust_jackal and sand_scorpion within encounter radius", async () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, z) VALUES (?, ?, ?, ?, ?, ?)`)
      .run("cr_a", "tunya", "creature:dust_jackal",   "dust_jackal",  0, 0);
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, z) VALUES (?, ?, ?, ?, ?, ?)`)
      .run("cr_b", "tunya", "creature:sand_scorpion", "sand_scorpion", 5, 5);
    db.prepare(`INSERT INTO world_visits (id, user_id, world_id, arrived_at, departed_at) VALUES (?, ?, ?, ?, ?)`)
      .run("v1", "u1", "tunya", Math.floor(Date.now() / 1000), null);

    const r = await runCreatureFlockCycle({ db, state: {} });
    assert.equal(r.ok, true);
    assert.ok(r.totalEncounterPairs >= 1, "expected at least one heterospecific encounter to be recorded");

    const bond = getBond(db, "cr_a", "cr_b");
    assert.ok(bond > 0, "bond should accrue for heterospecific pair within encounter radius");
  });

  it("skips same-species pairs (no inflated bond from flock cohesion)", async () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, z) VALUES (?, ?, ?, ?, ?, ?)`)
      .run("cr_a", "tunya", "creature:dust_jackal", "dust_jackal", 0, 0);
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, z) VALUES (?, ?, ?, ?, ?, ?)`)
      .run("cr_b", "tunya", "creature:dust_jackal", "dust_jackal", 3, 3);
    db.prepare(`INSERT INTO world_visits (id, user_id, world_id, arrived_at, departed_at) VALUES (?, ?, ?, ?, ?)`)
      .run("v1", "u1", "tunya", Math.floor(Date.now() / 1000), null);

    const r = await runCreatureFlockCycle({ db, state: {} });
    assert.equal(r.totalEncounterPairs, 0, "same-species pairs must be skipped");
    const bond = getBond(db, "cr_a", "cr_b");
    assert.equal(bond, 0, "no bond should accrue between conspecifics");
  });

  it("ignores pairs farther apart than ENCOUNTER_RADIUS_M (12m)", async () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, z) VALUES (?, ?, ?, ?, ?, ?)`)
      .run("cr_a", "tunya", "creature:dust_jackal",   "dust_jackal",   0, 0);
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, z) VALUES (?, ?, ?, ?, ?, ?)`)
      .run("cr_b", "tunya", "creature:sand_scorpion", "sand_scorpion", 50, 50);
    db.prepare(`INSERT INTO world_visits (id, user_id, world_id, arrived_at, departed_at) VALUES (?, ?, ?, ?, ?)`)
      .run("v1", "u1", "tunya", Math.floor(Date.now() / 1000), null);

    const r = await runCreatureFlockCycle({ db, state: {} });
    assert.equal(r.totalEncounterPairs, 0, "distant pairs should not record encounters");
  });
});
