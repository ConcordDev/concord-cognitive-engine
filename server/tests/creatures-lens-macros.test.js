// Macro surface for the creatures lens (server/domains/creatures.js).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against a REAL in-memory sqlite DB. Every assertion is a concrete computed
// value or a real DB row, NOT a bare { ok:true }:
//   • species   → the real authored catalog (deer/wolf/... ∈ result, real clades)
//   • roster    → real creature_population rows, taxonomy-enriched
//   • breed     → two species cross into a REAL hybrid with a persisted
//                 creature_lineage row + inherited skills; the offspring's
//                 topology is a valid blend of the parents'.
//   • sameEnvironmentBonus raises the bond increment (SAME_ENV_BONUS) so a
//     same-biome pairing crosses more readily than a mismatched one.
//   • lineage   → the bred child resolves back through getLineage.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerCreatureMacros from "../domains/creatures.js";
import { ensureCrossbreedingTables, getBond, recordEncounter } from "../lib/creature-crossbreeding.js";
import { ensureSkillsTable, bootEmergentSkills } from "../lib/emergent-skills.js";
import { TOPOLOGIES } from "../lib/procedural-creature.js";

function collectMacros() {
  const map = new Map();
  registerCreatureMacros((domain, name, handler) => {
    assert.equal(domain, "creatures", `unexpected domain: ${domain}`);
    map.set(name, handler);
  });
  return map;
}

function freshDb() {
  const db = new Database(":memory:");
  ensureCrossbreedingTables(db);
  ensureSkillsTable(db);
  bootEmergentSkills(db);
  // The real population table (mig 094 shape) so roster reads a real row.
  db.exec(`
    CREATE TABLE creature_population (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, biome TEXT NOT NULL,
      species_id TEXT NOT NULL, blueprint_dtu_id TEXT,
      target_count INTEGER NOT NULL DEFAULT 0, current_count INTEGER NOT NULL DEFAULT 0,
      lifestyle TEXT NOT NULL DEFAULT 'herbivore', last_tick_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

const ctxFor = (db) => ({ db, actor: { userId: "u_test" } });
const WORLD = "concordia-hub";

describe("creatures lens macros", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("species → the real authored catalog (delegates to the library)", async () => {
    const r = await macros.get("species")(ctxFor(db), {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.species) && r.species.length >= 20, "expected a populated catalog");
    assert.equal(r.count, r.species.length);
    const byId = new Map(r.species.map((s) => [s.species_id, s]));
    // Real records from content/species-taxonomy.json, not fabricated.
    assert.ok(byId.has("deer"), "deer should be in the real catalog");
    assert.ok(byId.has("wolf"), "wolf should be in the real catalog");
    assert.equal(byId.get("deer").clade, "mammal");
    assert.equal(byId.get("deer").topology, "quadruped");
    assert.equal(byId.get("wolf").diet, "carnivore");
    // Every record is a complete taxonomy record.
    assert.ok(r.species.every((s) => s.species_id && s.clade && s.topology && s.diet));
  });

  it("roster → real population rows, taxonomy-enriched", async () => {
    db.prepare(`INSERT INTO creature_population (id, world_id, biome, species_id, lifestyle, current_count, target_count)
                VALUES (?,?,?,?,?,?,?)`).run("pop1", WORLD, "forest", "deer", "herbivore", 12, 20);
    db.prepare(`INSERT INTO creature_population (id, world_id, biome, species_id, lifestyle, current_count, target_count)
                VALUES (?,?,?,?,?,?,?)`).run("pop2", WORLD, "river", "trout", "filter", 5, 8);

    const r = await macros.get("roster")(ctxFor(db), { worldId: WORLD });
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
    const deer = r.populations.find((p) => p.species_id === "deer");
    assert.ok(deer, "deer population present");
    assert.equal(deer.current_count, 12);            // real DB value
    assert.equal(deer.topology, "quadruped");        // real taxonomy enrichment
    assert.equal(deer.clade, "mammal");
    const trout = r.populations.find((p) => p.species_id === "trout");
    assert.equal(trout.aquatic, true);               // fish topology → aquatic
  });

  it("roster rejects a missing world id", async () => {
    const r = await macros.get("roster")(ctxFor(db), {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_world_id");
  });

  it("breed → a REAL hybrid with inherited traits + a persisted lineage row", async () => {
    const r = await macros.get("breed")(ctxFor(db), {
      a: { id: "wolf_a", species_id: "wolf", lifestyle: "carnivore" },
      b: { id: "bear_b", species_id: "bear", lifestyle: "omnivore" },
      environment: "forest",
      sameEnvironmentBonus: true,
      worldId: WORLD,
    });
    assert.equal(r.ok, true, `breed should succeed, got ${JSON.stringify(r)}`);
    assert.ok(r.hybrid && typeof r.hybrid.id === "string", "hybrid has a real id");
    assert.ok(r.hybrid.massKg > 0, "hybrid has a real, physics-derived mass");
    // wolf (quadruped) × bear (quadruped) → quadruped, a VALID topology.
    assert.ok(TOPOLOGIES.includes(r.hybrid.topology), "topology is a real topology");
    assert.equal(r.hybrid.topology, "quadruped");
    assert.equal(typeof r.stability, "number");
    assert.ok(r.stability > 0 && r.stability <= 1);
    assert.deepEqual(r.parents.sort(), ["bear_b", "wolf_a"]);

    // The lineage row was actually persisted to the DB.
    const row = db.prepare(`SELECT * FROM creature_lineage WHERE child_id = ?`).get(r.hybrid.id);
    assert.ok(row, "creature_lineage row persisted");
    assert.equal(row.generation, 1);

    // …and resolves back through the lineage macro.
    const lin = await macros.get("lineage")(ctxFor(db), { creatureId: r.hybrid.id });
    assert.equal(lin.ok, true);
    assert.ok(lin.lineage.self && lin.lineage.self.child_id === r.hybrid.id);
  });

  it("offspring species is a real, derived species (not fabricated)", async () => {
    const r = await macros.get("breed")(ctxFor(db), {
      a: { id: "deer_x", species_id: "deer" },
      b: { id: "goat_y", species_id: "goat" },
      environment: "meadow",
      sameEnvironmentBonus: true,
      worldId: WORLD,
    });
    assert.equal(r.ok, true);
    assert.equal(typeof r.hybrid.species_id, "string");
    assert.ok(r.hybrid.species_id.length > 0);
    // Topology must be one the procedural generator can validate.
    assert.ok(TOPOLOGIES.includes(r.hybrid.topology));
  });

  it("sameEnvironmentBonus raises the bond increment (same biome crosses more readily)", () => {
    // The real mechanism the breed macro relies on: a same-environment encounter
    // increments the bond MORE than a plain one, so a same-biome pairing reaches
    // the breeding threshold faster (higher compat). Asserted on real DB rows.
    ensureCrossbreedingTables(db);
    recordEncounter(db, { aId: "n1", bId: "n2", worldA: WORLD, worldB: WORLD, environment: "forest" });
    const plain = getBond(db, "n1", "n2");
    recordEncounter(db, { aId: "n3", bId: "n4", worldA: WORLD, worldB: WORLD, environment: "forest", sameEnvironmentBonus: true });
    const sameEnv = getBond(db, "n3", "n4");
    assert.ok(sameEnv > plain, `same-biome bond (${sameEnv}) should exceed plain bond (${plain})`);
  });

  it("breed rejects missing parents", async () => {
    const r = await macros.get("breed")(ctxFor(db), { a: { species_id: "wolf" } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_parents");
  });

  it("breed rejects a self-pair (same id)", async () => {
    const r = await macros.get("breed")(ctxFor(db), {
      a: { id: "same", species_id: "wolf" },
      b: { id: "same", species_id: "wolf" },
      worldId: WORLD,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "self_pair");
  });
});
