// server/tests/wave2-bestiary-taming.test.js
//
// Pins Wave 2 contract:
//   T1.2 — bestiary: recordSighting upserts + debounces; stats aggregates
//   T1.3 — taming: success removes NPC + creates companion with blueprint;
//          failure decays bond; breeding two companions spawns a hybrid
//          AND a new companion for the player

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { recordSighting, getDiscoveries, getStats } from "../lib/bestiary.js";
import { attemptTame, breedCompanions, tameChance } from "../lib/taming.js";

let db;

function buildSchema(d) {
  d.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL,
      archetype TEXT, species_id TEXT,
      x REAL DEFAULT 0, y REAL DEFAULT 0, z REAL DEFAULT 0,
      mass_kg REAL, height_m REAL, topology TEXT,
      is_dead INTEGER DEFAULT 0, died_at INTEGER
    );
    CREATE TABLE player_companions (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, creature_id TEXT NOT NULL,
      name TEXT NOT NULL, tame_bond REAL DEFAULT 100, loyalty REAL DEFAULT 50,
      level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0,
      caught_at INTEGER DEFAULT (unixepoch()),
      world_id TEXT DEFAULT 'concordia-hub',
      deployed INTEGER DEFAULT 0, last_action_at INTEGER,
      blueprint_json TEXT, source_kind TEXT DEFAULT 'world_npc',
      source_ref TEXT,
      UNIQUE(owner_id, creature_id)
    );
    CREATE TABLE creature_bonds (
      a_id TEXT NOT NULL, b_id TEXT NOT NULL,
      world_a TEXT, world_b TEXT,
      bond REAL DEFAULT 0, environment TEXT,
      last_seen_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (a_id, b_id)
    );
    CREATE TABLE creature_lineage (
      child_id TEXT PRIMARY KEY, parent_a TEXT NOT NULL, parent_b TEXT NOT NULL,
      generation INTEGER DEFAULT 1, stability REAL DEFAULT 0.5,
      cross_world INTEGER DEFAULT 0, blueprint TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE world_hybrid_creatures (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL,
      x REAL DEFAULT 0, y REAL DEFAULT 0, z REAL DEFAULT 0,
      blueprint_json TEXT NOT NULL,
      parent_a TEXT, parent_b TEXT,
      generation INTEGER DEFAULT 1, stability REAL DEFAULT 0.5,
      cross_world INTEGER DEFAULT 0, alive INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE player_creature_discoveries (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('hybrid','authored','tamed','bred')),
      species_ref TEXT NOT NULL,
      first_seen_at INTEGER DEFAULT (unixepoch()),
      last_seen_at INTEGER DEFAULT (unixepoch()),
      sightings INTEGER DEFAULT 1,
      meta_json TEXT,
      UNIQUE(user_id, world_id, kind, species_ref)
    );
    CREATE TABLE player_skill_levels (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      skill_type TEXT NOT NULL, native_world_type TEXT NOT NULL,
      level INTEGER DEFAULT 0, xp INTEGER DEFAULT 0, xp_to_next INTEGER DEFAULT 100
    );
  `);
}

before(() => {
  db = new Database(":memory:");
  buildSchema(db);

  // A wild wolf to tame, plus a wild falcon for cross-species breeding.
  db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, mass_kg, height_m, topology, x, z) VALUES
    ('npc_wolf',   'concordia', 'creature:beast',  'wolf',   45, 0.9, 'quadruped',         10, 10),
    ('npc_falcon', 'concordia', 'creature:beast',  'falcon',  8, 0.5, 'winged_biped',      11, 11),
    ('npc_human',  'concordia', 'guard',           NULL,     70, 1.8, 'humanoid',          50, 50)
  `).run();
});

after(() => { db?.close(); });

describe("T1.2 — bestiary", () => {
  it("recordSighting creates a row on first call", () => {
    const r = recordSighting(db, "user_a", { worldId: "concordia", kind: "hybrid", speciesRef: "hyb_1" });
    assert.equal(r.ok, true);
    assert.equal(r.isNew, true);
    assert.equal(r.sightings, 1);
  });

  it("debounces re-sighting within 60s", () => {
    const r = recordSighting(db, "user_a", { worldId: "concordia", kind: "hybrid", speciesRef: "hyb_1" });
    assert.equal(r.ok, true);
    assert.equal(r.debounced, true);
    assert.equal(r.sightings, 1, "counter unchanged inside debounce window");
  });

  it("getDiscoveries filters by kind", () => {
    recordSighting(db, "user_a", { worldId: "concordia", kind: "authored", speciesRef: "dragon-aenor" });
    const allRows = getDiscoveries(db, "user_a");
    const hybrids = getDiscoveries(db, "user_a", { kind: "hybrid" });
    assert.ok(allRows.length >= 2);
    assert.ok(hybrids.every((r) => r.kind === "hybrid"));
  });

  it("getStats reports per-kind counts", () => {
    const stats = getStats(db, "user_a");
    assert.ok(stats.total >= 2);
    assert.ok(stats.hybrid >= 1);
    assert.ok(stats.authored >= 1);
  });

  it("rejects invalid kind", () => {
    const r = recordSighting(db, "user_a", { worldId: "concordia", kind: "xyzzy", speciesRef: "x" });
    assert.equal(r.ok, false);
  });
});

describe("T1.3 — taming", () => {
  it("tameChance respects baseline + bond", () => {
    // No bond yet → at most 25% + skill bonus (0% with no skill).
    const noBond = tameChance(db, "user_b", "npc_wolf");
    assert.ok(noBond >= 0.20 && noBond <= 0.30);
    // Seed a max bond and verify chance climbs.
    db.prepare(`INSERT INTO creature_bonds (a_id, b_id, world_a, world_b, bond) VALUES (?, ?, 'concordia', 'concordia', 200)`)
      .run("npc_wolf" < "user_b" ? "npc_wolf" : "user_b", "npc_wolf" < "user_b" ? "user_b" : "npc_wolf");
    const fullBond = tameChance(db, "user_b", "npc_wolf");
    assert.ok(fullBond >= noBond + 0.20, `bond should bump chance, ${noBond} → ${fullBond}`);
  });

  it("forced-success tame removes the NPC and creates a companion", () => {
    const r = attemptTame(db, "user_b", "npc_wolf", { rng: () => 0, name: "Fang" });
    assert.equal(r.ok, true);
    assert.equal(r.success, true);
    assert.ok(r.companion);
    assert.equal(r.companion.name, "Fang");
    const npcRow = db.prepare(`SELECT is_dead FROM world_npcs WHERE id = 'npc_wolf'`).get();
    assert.equal(npcRow.is_dead, 1);
    const compRow = db.prepare(`SELECT * FROM player_companions WHERE id = ?`).get(r.companion.id);
    assert.ok(compRow);
    assert.equal(compRow.source_kind, "world_npc");
    const bp = JSON.parse(compRow.blueprint_json);
    assert.equal(bp.topology, "quadruped");
  });

  it("forced-failure tame decays the bond", () => {
    // Falcon — fresh creature. Seed a bond first.
    const [a, b] = "npc_falcon" < "user_c" ? ["npc_falcon", "user_c"] : ["user_c", "npc_falcon"];
    db.prepare(`INSERT INTO creature_bonds (a_id, b_id, world_a, world_b, bond) VALUES (?, ?, 'concordia', 'concordia', 100)`)
      .run(a, b);
    const r = attemptTame(db, "user_c", "npc_falcon", { rng: () => 0.99 });
    assert.equal(r.ok, true);
    assert.equal(r.success, false);
    const after = db.prepare(`SELECT bond FROM creature_bonds WHERE a_id = ? AND b_id = ?`).get(a, b);
    assert.ok(after.bond < 100, "bond decayed on failed tame");
  });

  it("non-creature NPC rejects taming", () => {
    const r = attemptTame(db, "user_b", "npc_human", { rng: () => 0 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_a_creature");
  });

  it("already-tamed creature is removed from world_npcs and can't be re-tamed", () => {
    // npc_wolf was tamed earlier in this suite — its is_dead flag is set,
    // so the NPC-load query (which filters is_dead=0) treats it as gone.
    // This is the right behavior: a tamed creature shouldn't be re-tamable
    // by anyone, including its original tamer.
    const r = attemptTame(db, "user_d", "npc_wolf", { rng: () => 0 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "creature_not_found");
  });
});

describe("T1.3 — breeding companions", () => {
  it("breeds two companions into a new hybrid + new companion", async () => {
    // Tame two distinct creatures for user_e.
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, mass_kg, height_m, topology, x, z) VALUES
      ('npc_drk', 'concordia', 'creature:beast', 'direwolf', 80, 1.2, 'quadruped', 60, 60),
      ('npc_eag', 'concordia', 'creature:beast', 'eagle',    12, 0.7, 'winged_biped', 61, 61)
    `).run();
    const ta = attemptTame(db, "user_e", "npc_drk", { rng: () => 0, name: "Shadow" });
    const tb = attemptTame(db, "user_e", "npc_eag", { rng: () => 0, name: "Sky" });
    assert.equal(ta.success, true);
    assert.equal(tb.success, true);

    const r = await breedCompanions(db, "user_e", ta.companion.id, tb.companion.id, { name: "Stormwing" });
    assert.equal(r.ok, true, `breeding should succeed: ${JSON.stringify(r)}`);
    assert.ok(r.hybrid);
    assert.ok(r.hybrid.hybridId.startsWith("hybrid_"));
    assert.ok(r.companion);
    assert.equal(r.companion.name, "Stormwing");

    // Hybrid lands in world_hybrid_creatures
    const hRow = db.prepare(`SELECT * FROM world_hybrid_creatures WHERE id = ?`).get(r.hybrid.hybridId);
    assert.ok(hRow);
    assert.equal(hRow.parent_a, ta.companion.id);
    assert.equal(hRow.parent_b, tb.companion.id);

    // Companion clone lands in player_companions
    const cRow = db.prepare(`SELECT * FROM player_companions WHERE id = ?`).get(r.companion.id);
    assert.ok(cRow);
    assert.equal(cRow.source_kind, "bred");
    assert.equal(cRow.owner_id, "user_e");
  });

  it("rejects breeding non-owned companions", async () => {
    const r = await breedCompanions(db, "user_e", "nonexistent_a", "nonexistent_b");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "companion_not_found");
  });

  it("rejects self-pair", async () => {
    const owned = db.prepare(`SELECT id FROM player_companions WHERE owner_id = 'user_e' LIMIT 1`).get();
    const r = await breedCompanions(db, "user_e", owned.id, owned.id);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "self_pair");
  });
});
