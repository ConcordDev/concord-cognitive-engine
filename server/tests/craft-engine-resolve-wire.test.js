/**
 * Living Society — Phase 0 (part 3): craft-engine ← craft-resolve wiring.
 *
 * Pins that executeCraft now derives output quality from the input resource
 * PROPERTIES via the single craft-resolve layer:
 *   - stronger mats / skill → higher quality_multiplier + resolved provenance
 *   - the potency floor gates god-tier output (soft fizzle: weak item + debuff,
 *     mats consumed, never a throw)
 *   - an explicit opts.qualityMultiplier still wins (legacy minigame back-compat)
 *   - per-slot properties_json overrides raise potency (crossbreed-drop hook)
 *   - CONCORD_CRAFT_RESOLVE=0 disables the layer entirely
 *
 * Run: node --test tests/craft-engine-resolve-wire.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { executeCraft } from "../lib/crafting/craft-engine.js";
import { seedResourceProperties } from "../lib/resources.js";

const WORLD_ID = "concordia-hub";
const USER = "user_craft";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (
      id TEXT PRIMARY KEY, world_type TEXT, rule_modulators TEXT
    );
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY, creator_id TEXT, type TEXT, name TEXT,
      data TEXT, skill_level INTEGER, created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE player_skill_levels (
      id TEXT PRIMARY KEY, user_id TEXT, skill_type TEXT,
      native_world_type TEXT, level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0,
      xp_to_next INTEGER DEFAULT 100, last_used_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, skill_type, native_world_type)
    );
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT, item_type TEXT, item_id TEXT,
      item_name TEXT, quantity INTEGER DEFAULT 1, quality TEXT,
      acquired_at INTEGER DEFAULT (unixepoch()), properties_json TEXT,
      spoils_at INTEGER
    );
    CREATE TABLE user_active_effects (
      id TEXT PRIMARY KEY, user_id TEXT, effect_id TEXT, kind TEXT,
      magnitude REAL, source_dtu_id TEXT,
      started_at INTEGER DEFAULT (unixepoch()), expires_at INTEGER
    );
    CREATE TABLE resource_properties (
      item_id TEXT PRIMARY KEY, potency INTEGER, affinity TEXT, stability INTEGER,
      volume REAL, weight REAL, rarity_tier INTEGER, source_type TEXT,
      magical_sub TEXT, updated_at INTEGER DEFAULT (unixepoch())
    );
  `);
  db.prepare("INSERT INTO worlds (id, world_type, rule_modulators) VALUES (?, 'standard', '{}')").run(WORLD_ID);
  db.prepare(`INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level)
              VALUES ('s1', ?, 'crafting', 'standard', 60)`).run(USER);
  seedResourceProperties(db);
  return db;
}

let _rid = 0;
function makeRecipe(db, { resources, minPotency = 0, outputType = "weapon", outputSubtype = "sword" } = {}) {
  const id = `recipe_${++_rid}`;
  const data = {
    spec: { name: "Test Blade", output_type: outputType, output_subtype: outputSubtype, minPotency },
    resource_requirements: resources.map((r) => ({ resource_id: r.itemId, quantity: r.qty })),
    skill_requirements: [],
    output_type: outputType,
  };
  db.prepare(`INSERT INTO dtus (id, creator_id, type, name, data, skill_level)
              VALUES (?, 'system', 'recipe', 'Test Blade', ?, 0)`).run(id, JSON.stringify(data));
  return id;
}

function giveItem(db, itemId, qty, propertiesJson = null) {
  db.prepare(`INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, properties_json)
              VALUES (?, ?, 'material', ?, ?, ?, ?)`)
    .run(`inv_${itemId}_${Math.random()}`, USER, itemId, itemId, qty, propertiesJson);
}

beforeEach(() => { delete process.env.CONCORD_CRAFT_RESOLVE; });

describe("Phase 0.3 — executeCraft uses craft-resolve", () => {
  it("derives quality + resource provenance from input properties", () => {
    const db = makeDb();
    giveItem(db, "iron_ingot", 2);
    const recipe = makeRecipe(db, { resources: [{ itemId: "iron_ingot", qty: 2 }] });
    const r = executeCraft(db, USER, WORLD_ID, recipe);
    assert.equal(r.ok, true);
    assert.ok(r.resolved, "resolved provenance present");
    assert.equal(r.resolved.outputAffinity, "physical");
    assert.ok(r.resolved.outputPotency > 0);
    assert.ok(r.dtu.data.resource_affinity === "physical");
    assert.ok(r.dtu.data.quality_multiplier >= 0.5 && r.dtu.data.quality_multiplier <= 2.0);
  });

  it("stronger mats yield a higher quality_multiplier than basic mats", () => {
    const dbA = makeDb();
    giveItem(dbA, "wood", 2);
    const rBasic = executeCraft(dbA, USER, WORLD_ID, makeRecipe(dbA, { resources: [{ itemId: "wood", qty: 2 }] }));

    const dbB = makeDb();
    giveItem(dbB, "dragonbone", 2);
    const rStrong = executeCraft(dbB, USER, WORLD_ID, makeRecipe(dbB, { resources: [{ itemId: "dragonbone", qty: 2 }] }));

    assert.ok(
      rStrong.dtu.data.quality_multiplier > rBasic.dtu.data.quality_multiplier,
      `${rStrong.dtu.data.quality_multiplier} !> ${rBasic.dtu.data.quality_multiplier}`,
    );
  });

  it("the potency floor gates god-tier output (soft fizzle: weak item + debuff, mats consumed)", () => {
    const db = makeDb();
    giveItem(db, "wood", 1);
    giveItem(db, "stone", 1);
    const recipe = makeRecipe(db, {
      resources: [{ itemId: "wood", qty: 1 }, { itemId: "stone", qty: 1 }],
      minPotency: 80,
    });
    const r = executeCraft(db, USER, WORLD_ID, recipe);
    assert.equal(r.ok, true, "soft failure — never throws / never ok:false");
    assert.equal(r.failed, true);
    assert.equal(r.resolved.reason, "potency_floor_not_met");
    assert.equal(r.dtu.data.quality_multiplier, 0.5, "fizzle yields a weak item");
    assert.equal(r.dtu.data.craft_failed, true);
    // mats consumed
    const woodLeft = db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM player_inventory WHERE user_id=? AND item_id='wood'").get(USER).n;
    assert.equal(woodLeft, 0);
    // a debuff row was written
    const debuff = db.prepare("SELECT * FROM user_active_effects WHERE user_id=? AND kind='debuff'").get(USER);
    assert.ok(debuff, "debuff applied");
    assert.equal(debuff.effect_id, "craft_fizzle");
    assert.ok(r.debuff && r.debuff.effect_id === "craft_fizzle");
  });

  it("strong mats + fuel + station CLEAR the potency floor (the god-tier path)", () => {
    const db = makeDb();
    giveItem(db, "dragonbone", 2);
    giveItem(db, "grand_soul_gem", 1);
    const recipe = makeRecipe(db, {
      resources: [{ itemId: "dragonbone", qty: 2 }, { itemId: "grand_soul_gem", qty: 1 }],
      minPotency: 80,
    });
    const r = executeCraft(db, USER, WORLD_ID, recipe, { stationQuality: 100 });
    // The floor itself is met (a magical power source + station push potency
    // past 80). Stability-driven backfire is a SEPARATE, independent roll — so
    // we assert specifically that the failure is never a potency-floor fizzle.
    assert.ok(r.resolved.outputPotency >= 80, `potency ${r.resolved.outputPotency} < 80`);
    assert.notEqual(r.resolved.reason, "potency_floor_not_met");
  });

  it("an explicit opts.qualityMultiplier wins (legacy minigame back-compat)", () => {
    const db = makeDb();
    giveItem(db, "iron_ingot", 2);
    const recipe = makeRecipe(db, { resources: [{ itemId: "iron_ingot", qty: 2 }] });
    const r = executeCraft(db, USER, WORLD_ID, recipe, { qualityMultiplier: 1.85 });
    assert.equal(r.dtu.data.quality_multiplier, 1.85);
    // no resolve was run when an explicit multiplier is supplied
    assert.equal(r.resolved, undefined);
  });

  it("a per-slot properties_json override raises output potency", () => {
    const dbBase = makeDb();
    giveItem(dbBase, "hide", 2);
    const base = executeCraft(dbBase, USER, WORLD_ID, makeRecipe(dbBase, { resources: [{ itemId: "hide", qty: 2 }], outputType: "armor", outputSubtype: "armor" }));

    const dbHot = makeDb();
    giveItem(dbHot, "hide", 2, JSON.stringify({ potency: 90, affinity: "bio", stability: 88 }));
    const hot = executeCraft(dbHot, USER, WORLD_ID, makeRecipe(dbHot, { resources: [{ itemId: "hide", qty: 2 }], outputType: "armor", outputSubtype: "armor" }));

    assert.ok(
      hot.resolved.outputPotency > base.resolved.outputPotency,
      `${hot.resolved.outputPotency} !> ${base.resolved.outputPotency}`,
    );
  });

  it("CONCORD_CRAFT_RESOLVE=0 disables the resolve layer", () => {
    process.env.CONCORD_CRAFT_RESOLVE = "0";
    const db = makeDb();
    giveItem(db, "iron_ingot", 2);
    const recipe = makeRecipe(db, { resources: [{ itemId: "iron_ingot", qty: 2 }] });
    const r = executeCraft(db, USER, WORLD_ID, recipe);
    assert.equal(r.ok, true);
    assert.equal(r.resolved, undefined);
    assert.equal(r.dtu.data.quality_multiplier, 1.0, "falls back to neutral 1.0×");
    assert.equal(r.dtu.data.resource_affinity, undefined);
  });
});
