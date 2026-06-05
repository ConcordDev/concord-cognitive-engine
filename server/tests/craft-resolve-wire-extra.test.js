/**
 * Living Society — Phase 0 (part 4): the remaining clean craft-resolve wraps.
 *
 * Completes Phase 0's "wrap, don't rewrite" for the two crafting systems that
 * consume materials with a clean property path:
 *   - tool-tree.craftTool — tool quality now derives from the consumed
 *     materials' resource PROPERTIES (stronger mats → better tool), never
 *     blocking the basic survival path.
 *   - glyph-spells.mintSpell — optional power-source FUEL (soul gems / mana /
 *     aether) amplifies the composed spell (the "Fireball I → V" gradient),
 *     consuming the fuel from inventory. Fuel only ever strengthens; a spell
 *     minted without fuel is byte-identical to the pre-P0 path.
 *
 * Run: node --test tests/craft-resolve-wire-extra.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { seedResourceProperties } from "../lib/resources.js";
import { TOOL_RECIPES, seedToolRecipes, craftTool } from "../lib/tool-tree.js";
import { seedDefaultGlyphLibrary, listGlyphComponents, mintSpell } from "../lib/glyph-spells.js";

const WORLD = "concordia-hub";
const USER = "user_x";

// ── tool-tree ────────────────────────────────────────────────────────────────

function makeToolDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tool_recipes (
      id TEXT PRIMARY KEY, name TEXT, description TEXT, tier INTEGER,
      required_tool_tier INTEGER, required_skill_level INTEGER,
      materials_json TEXT, output_quality INTEGER
    );
    CREATE TABLE player_tools (
      id TEXT PRIMARY KEY, user_id TEXT, recipe_id TEXT, quality INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT DEFAULT 'concordia-hub',
      item_type TEXT, item_id TEXT, item_name TEXT, quantity INTEGER DEFAULT 1,
      quality TEXT, acquired_at INTEGER DEFAULT (unixepoch()), properties_json TEXT
    );
    CREATE TABLE dtus (id TEXT PRIMARY KEY, owner_user_id TEXT, skill_level INTEGER, tags_json TEXT);
    CREATE TABLE resource_properties (
      item_id TEXT PRIMARY KEY, potency INTEGER, affinity TEXT, stability INTEGER,
      volume REAL, weight REAL, rarity_tier INTEGER, source_type TEXT, magical_sub TEXT,
      updated_at INTEGER DEFAULT (unixepoch())
    );
  `);
  seedToolRecipes(db);
  seedResourceProperties(db);
  return db;
}

function giveInv(db, itemId, qty) {
  db.prepare(`INSERT INTO player_inventory (id, user_id, world_id, item_type, item_id, item_name, quantity)
              VALUES (?, ?, ?, 'material', ?, ?, ?)`)
    .run(`inv_${itemId}_${Math.random()}`, USER, WORLD, itemId, itemId, qty);
}

// A recipe that consumes a single material id with no tier/skill gate, so we
// can swap the material and isolate the property effect.
function recipeConsuming(db, id, materialId, baseQuality) {
  db.prepare(`INSERT INTO tool_recipes (id, name, description, tier, required_tool_tier, required_skill_level, materials_json, output_quality)
              VALUES (?, ?, '', 1, -1, 0, ?, ?)`)
    .run(id, id, JSON.stringify([{ id: materialId, quantity: 2 }]), baseQuality);
}

describe("Phase 0.4 — tool-tree.craftTool uses craft-resolve", () => {
  it("derives tool quality from the consumed materials' properties", () => {
    const db = makeToolDb();
    recipeConsuming(db, "weak_axe", "wood", 40);
    recipeConsuming(db, "strong_axe", "dragonbone", 40);
    giveInv(db, "wood", 2);
    giveInv(db, "dragonbone", 2);

    const weak = craftTool(db, USER, "weak_axe", WORLD);
    const strong = craftTool(db, USER, "strong_axe", WORLD);
    assert.equal(weak.ok, true);
    assert.equal(strong.ok, true);
    assert.ok(
      strong.tool.quality > weak.tool.quality,
      `${strong.tool.quality} !> ${weak.tool.quality}`,
    );
    assert.equal(strong.tool.resource_affinity, "physical");
  });

  it("CONCORD_CRAFT_RESOLVE=0 restores the flat output_quality", () => {
    process.env.CONCORD_CRAFT_RESOLVE = "0";
    try {
      const db = makeToolDb();
      recipeConsuming(db, "axe", "dragonbone", 40);
      giveInv(db, "dragonbone", 2);
      const r = craftTool(db, USER, "axe", WORLD);
      assert.equal(r.tool.quality, 40);
      assert.equal(r.tool.resource_affinity, undefined);
    } finally { delete process.env.CONCORD_CRAFT_RESOLVE; }
  });

  it("still crafts the seeded base recipes (no regression)", () => {
    const db = makeToolDb();
    const baseRecipe = TOOL_RECIPES.find((r) => r.required_tool_tier === -1 && JSON.parse(r.materials_json).length === 0);
    const r = craftTool(db, USER, baseRecipe.id, WORLD);
    assert.equal(r.ok, true);
    // no materials → resolve is skipped → flat output_quality
    assert.equal(r.tool.quality, baseRecipe.output_quality);
  });
});

// ── glyph-spells fuel ──────────────────────────────────────────────────────────

function makeSpellDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE glyph_components (
      id TEXT PRIMARY KEY, glyph TEXT, label TEXT, element TEXT, damage REAL,
      range_m REAL, stamina_cost REAL, mana_cost REAL, cooldown_s REAL, narrative TEXT
    );
    CREATE TABLE player_glyph_spells (
      id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT, recipe_dtu_id TEXT,
      composed_glyph TEXT, component_chain TEXT, element TEXT, max_damage REAL,
      range_m REAL, stamina_cost REAL, mana_cost REAL, cooldown_s REAL, composed_at INTEGER
    );
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT, data TEXT,
      skill_level INTEGER, total_experience INTEGER, created_at INTEGER
    );
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT DEFAULT 'concordia-hub',
      item_type TEXT, item_id TEXT, item_name TEXT, quantity INTEGER DEFAULT 1,
      quality TEXT, acquired_at INTEGER DEFAULT (unixepoch()), properties_json TEXT
    );
    CREATE TABLE resource_properties (
      item_id TEXT PRIMARY KEY, potency INTEGER, affinity TEXT, stability INTEGER,
      volume REAL, weight REAL, rarity_tier INTEGER, source_type TEXT, magical_sub TEXT,
      updated_at INTEGER DEFAULT (unixepoch())
    );
  `);
  seedDefaultGlyphLibrary(db);
  seedResourceProperties(db);
  return db;
}

describe("Phase 0.4 — glyph-spells.mintSpell power-source fuel", () => {
  it("mints without fuel exactly as before (back-compat)", () => {
    const db = makeSpellDb();
    const ids = listGlyphComponents(db).slice(0, 2).map((c) => c.id);
    const r = mintSpell(db, { userId: USER, worldId: WORLD, componentIds: ids });
    assert.equal(r.ok, true);
    assert.equal(r.fuel, null);
  });

  it("fuel amplifies damage + range and is consumed from inventory", () => {
    const dbNo = makeSpellDb();
    const ids = listGlyphComponents(dbNo).slice(0, 2).map((c) => c.id);
    const base = mintSpell(dbNo, { userId: USER, worldId: WORLD, componentIds: ids });

    const dbFuel = makeSpellDb();
    const ids2 = listGlyphComponents(dbFuel).slice(0, 2).map((c) => c.id);
    giveInv(dbFuel, "grand_soul_gem", 1);
    giveInv(dbFuel, "aether_dust", 1);
    const fuelled = mintSpell(dbFuel, {
      userId: USER, worldId: WORLD, componentIds: ids2,
      fuelItemIds: ["grand_soul_gem", "aether_dust"],
    });

    assert.equal(fuelled.ok, true);
    assert.ok(fuelled.fuel, "fuel applied");
    assert.ok(fuelled.fuel.multiplier >= 1.0);
    assert.ok(
      fuelled.composed.max_damage > base.composed.max_damage,
      `${fuelled.composed.max_damage} !> ${base.composed.max_damage}`,
    );
    // both fuel items consumed
    const left = dbFuel.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM player_inventory WHERE user_id=?`).get(USER).n;
    assert.equal(left, 0);
    // provenance persisted on the recipe DTU meta (real column is `data`, not `meta_json`)
    const meta = JSON.parse(dbFuel.prepare("SELECT data FROM dtus WHERE id=?").get(fuelled.recipeId).data);
    assert.ok(meta.fuel && meta.fuel.items.length === 2);
  });

  it("fuel the player does not own is ignored (no boost, no phantom consume)", () => {
    const db = makeSpellDb();
    const ids = listGlyphComponents(db).slice(0, 2).map((c) => c.id);
    const r = mintSpell(db, {
      userId: USER, worldId: WORLD, componentIds: ids,
      fuelItemIds: ["grand_soul_gem"], // none in inventory
    });
    assert.equal(r.ok, true);
    assert.equal(r.fuel, null);
  });

  it("CONCORD_CRAFT_RESOLVE=0 disables fuel amplification", () => {
    process.env.CONCORD_CRAFT_RESOLVE = "0";
    try {
      const db = makeSpellDb();
      const ids = listGlyphComponents(db).slice(0, 2).map((c) => c.id);
      giveInv(db, "grand_soul_gem", 1);
      const r = mintSpell(db, {
        userId: USER, worldId: WORLD, componentIds: ids, fuelItemIds: ["grand_soul_gem"],
      });
      assert.equal(r.fuel, null);
      // fuel NOT consumed when the layer is off
      const left = db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM player_inventory WHERE user_id=?`).get(USER).n;
      assert.equal(left, 1);
    } finally { delete process.env.CONCORD_CRAFT_RESOLVE; }
  });
});

// ── inventory is user-global (Concord Link carries items across worlds) ───────
describe("inventory is user-global across worlds", () => {
  it("a material earned in one world is consumable when crafting in another", () => {
    const db = makeToolDb();
    // iron_ingot acquired while in 'world_alpha'
    db.prepare(`INSERT INTO player_inventory (id, user_id, world_id, item_type, item_id, item_name, quantity)
                VALUES ('inv_xw', ?, 'world_alpha', 'material', 'iron_ingot', 'iron_ingot', 5)`).run(USER);
    recipeConsuming(db, "xw_axe", "iron_ingot", 50); // consumes 2 per craft, no tier/skill gate
    // craft while standing in a DIFFERENT world — must draw from the global stock
    const r = craftTool(db, USER, "xw_axe", "world_beta");
    assert.equal(r.ok, true, `cross-world craft should succeed; got ${JSON.stringify(r)}`);
    const left = db.prepare(`SELECT SUM(quantity) q FROM player_inventory WHERE user_id=? AND item_id='iron_ingot'`).get(USER).q;
    assert.equal(left, 3, "2 units consumed from the global stock regardless of crafting world");
  });

  it("missing material is reported regardless of world (no phantom per-world stock)", () => {
    const db = makeToolDb();
    recipeConsuming(db, "xw_axe2", "iron_ingot", 50);
    const r = craftTool(db, USER, "xw_axe2", "world_beta");
    assert.equal(r.ok, false);
    assert.equal(r.error, "missing_material");
  });
});
