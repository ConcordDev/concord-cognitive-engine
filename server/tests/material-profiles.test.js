/**
 * Living Society — Phase 0.5: procedural food + crossbreed materials.
 *
 * Pins the audit-identified fixes:
 *   - a hybrid corpse now yields named, propertied drops (the empty-loot bug);
 *   - drop name/effects are derived from the creature (never a stale "meat");
 *   - parent profiles blend deterministically + the same parents → same blend;
 *   - generational breeding stays within the gen-decay bound (no runaway potency);
 *   - authored material profiles seed + resolve.
 *
 * Run: node --test tests/material-profiles.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up280 } from "../migrations/280_material_profiles.js";
import {
  profileFor,
  deriveProfileFromBlueprint,
  blendMaterialProfile,
  composeMaterialName,
  seedMaterialProfiles,
  MATERIAL_PROFILE_CATALOG,
} from "../lib/ecosystem/material-profiles.js";
import { composeDrops, isHybridCorpse } from "../lib/ecosystem/procedural-meat-composer.js";
import { rollLoot } from "../lib/ecosystem/loot-tables.js";

describe("Phase 0.5 — material profiles", () => {
  it("seeds + resolves the authored catalog", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE creature_corpses (id TEXT PRIMARY KEY, world_id TEXT, species_id TEXT);`);
    up280(db);
    const r = seedMaterialProfiles(db);
    assert.equal(r.ok, true);
    assert.equal(r.seeded, Object.keys(MATERIAL_PROFILE_CATALOG).length);
    const p = profileFor("venison", { db });
    assert.equal(p.affinity, "bio");
    assert.ok(p.effect_tags.includes("stamina_regen"));
  });

  it("derives a profile from a blueprint (heavier + more skills → higher potency)", () => {
    const small = deriveProfileFromBlueprint({ id: "c1", massKg: 10, skillIds: [] });
    const big = deriveProfileFromBlueprint({ id: "c2", massKg: 200, skillIds: ["a", "b", "c", "d"] });
    assert.ok(big.potency > small.potency);
    assert.ok(big.effect_tags.includes("strength"));
  });

  it("blends deterministically + stays bounded across generations (gen-decay)", () => {
    const a = profileFor("bear-meat");
    const b = profileFor("wolf-meat");
    const g1a = blendMaterialProfile(a, b, { stability: 0.6, generation: 1, seedKey: "X" });
    const g1b = blendMaterialProfile(a, b, { stability: 0.6, generation: 1, seedKey: "X" });
    assert.deepEqual(g1a, g1b, "same inputs → same blend");
    // potency never exceeds 100 and a later generation doesn't exceed the cap
    const g5 = blendMaterialProfile(a, b, { stability: 0.6, generation: 5, seedKey: "X" });
    assert.ok(g5.potency <= 100 && g5.potency >= 0);
    // conflicting affinities (physical bear vs chaos wolf) lower stability vs a pure blend
    const pure = blendMaterialProfile(a, a, { stability: 1.0, generation: 1, seedKey: "X" });
    assert.ok(g1a.stability < pure.stability, `${g1a.stability} !< ${pure.stability}`);
  });

  it("composeMaterialName is coherent + deterministic", () => {
    const a = profileFor("bear-meat");
    const b = profileFor("wolf-meat");
    const n1 = composeMaterialName(a, b, { seedKey: "p" });
    const n2 = composeMaterialName(a, b, { seedKey: "p" });
    assert.equal(n1, n2);
    assert.match(n1, /\w/);
  });
});

describe("Phase 0.5 — hybrid drop composition (empty-loot bug fix)", () => {
  it("a hybrid blueprint always yields ≥1 named, propertied drop", () => {
    const blueprint = { id: "hybrid_xyz", massKg: 90, skillIds: ["s1", "s2", "s3"], origin: "crossbreed", description: "boar × wolf hybrid" };
    const lineage = { parent_a: "boar", parent_b: "wolf", generation: 1, stability: 0.5,
      material_profile: blendMaterialProfile(profileFor("boar-meat"), profileFor("wolf-meat"), { generation: 1, seedKey: "boar|wolf" }) };
    const drops = composeDrops({ blueprint, lineage, qualityMultiplier: 1.0 });
    assert.ok(drops.length >= 1);
    assert.ok(drops[0].item_name && drops[0].item_name !== "raw meat");
    assert.ok(drops[0].properties && Array.isArray(drops[0].properties.effect_tags));
    assert.equal(drops[0].properties.source, "hybrid");
  });

  it("rollLoot composes from blueprint when the species has no table", () => {
    // 'hybrid_unknown' has no LOOT entry — pre-P0.5 this returned [].
    const empty = rollLoot("hybrid_unknown", 1.0);
    assert.deepEqual(empty, []);
    const composed = rollLoot("hybrid_unknown", 1.0, { blueprint: { id: "h", massKg: 60, skillIds: [], origin: "crossbreed", description: "x hybrid" } });
    assert.ok(composed.length >= 1);
  });

  it("isHybridCorpse detects lineage + crossbreed blueprint", () => {
    assert.equal(isHybridCorpse({ lineage_json: "{}" }), true);
    assert.equal(isHybridCorpse({ blueprint_json: JSON.stringify({ origin: "crossbreed" }) }), true);
    assert.equal(isHybridCorpse({ species_id: "deer" }), false);
  });
});
