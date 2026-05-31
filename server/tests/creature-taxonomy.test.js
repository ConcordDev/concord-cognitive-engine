// Wave 6 / Layer 1 + render path — the taxonomy spine + creature.for_world.
//
// Pins: authored taxonomy resolves clade/topology/diet; unknown species infer a
// topology; the for_world macro un-gates creatures (returns them WITH a topology
// descriptor) where appearance.for_world filtered them out; genotype variant
// surfaces for bred hybrids.
//
// Run: node --test tests/creature-taxonomy.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { taxonomyForSpecies, topologyForSpecies, isAquaticSpecies } from "../lib/species-taxonomy.js";
import registerCreatureMacros from "../domains/creatures.js";

function registry() {
  const m = new Map();
  registerCreatureMacros((d, n, fn) => m.set(`${d}.${n}`, fn));
  return m;
}

describe("Wave 6 — taxonomy spine", () => {
  it("resolves authored species to clade/topology/diet", () => {
    assert.deepEqual(taxonomyForSpecies("wolf"), { clade: "mammal", topology: "quadruped", diet: "carnivore" });
    assert.equal(taxonomyForSpecies("archive_owl").topology, "winged_biped");
    assert.equal(taxonomyForSpecies("reef_shark").topology, "shark");
    assert.equal(taxonomyForSpecies("deep_octopus").clade, "cephalopod");
  });

  it("strips the creature: prefix", () => {
    assert.equal(topologyForSpecies("creature:wolf"), "quadruped");
  });

  it("infers a topology for unknown species (total)", () => {
    assert.equal(topologyForSpecies("frost_viper_x7"), "serpentine"); // 'viper'
    assert.equal(topologyForSpecies("glimmer_hawk_h2"), "winged_biped"); // 'hawk'
    assert.equal(topologyForSpecies("nameless_thing"), "quadruped"); // safe default
  });

  it("flags aquatic species", () => {
    assert.equal(isAquaticSpecies("reef_eel"), true);
    assert.equal(isAquaticSpecies("wolf"), false);
  });
});

describe("Wave 6 — creature.for_world un-gates the bestiary", () => {
  let db;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, species_id TEXT,
      x REAL, y REAL, z REAL, is_dead INTEGER DEFAULT 0
    );
    CREATE TABLE creature_lineage (child_id TEXT, blueprint TEXT);`);
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, y, z) VALUES ('c1','tunya','creature:wolf','wolf',1,0,2)`).run();
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, y, z) VALUES ('c2','tunya','creature:reef_shark','reef_shark',3,0,4)`).run();
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, y, z, is_dead) VALUES ('c3','tunya','creature:deer','deer',5,0,6,1)`).run();
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, y, z) VALUES ('n1','tunya','warrior','',0,0,0)`).run();
    // a bred hybrid with a steam variant genotype
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, y, z) VALUES ('c4','tunya','creature:hyb_steamhorse','hyb_steamhorse',7,0,8)`).run();
    db.prepare(`INSERT INTO creature_lineage (child_id, blueprint) VALUES ('c4', ?)`).run(JSON.stringify({ genotype: { dominant: "steam", variant: "steam" } }));
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("returns live creatures WITH topology (not the humanoid NPC, not the dead one)", async () => {
    const reg = registry();
    const out = await reg.get("creatures.for_world")({ db }, { worldId: "tunya" });
    assert.equal(out.ok, true);
    const byId = new Map(out.creatures.map((c) => [c.id, c]));
    assert.ok(byId.has("c1") && byId.has("c2") && byId.has("c4"), "live creatures present");
    assert.ok(!byId.has("c3"), "dead creature excluded");
    assert.ok(!byId.has("n1"), "humanoid NPC excluded");
    assert.equal(byId.get("c1").topology, "quadruped");
    assert.equal(byId.get("c2").aquatic, true);
  });

  it("surfaces the genotype variant + variant tint for a bred hybrid", async () => {
    const reg = registry();
    const out = await reg.get("creatures.for_world")({ db }, { worldId: "tunya" });
    const c4 = out.creatures.find((c) => c.id === "c4");
    assert.equal(c4.variant, "steam");
    assert.equal(c4.coatColor, "#cdd6e0"); // steam tint
  });
});
