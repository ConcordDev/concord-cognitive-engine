/**
 * Crafting item-economy gap-closure (capability-map §3 items 3, 5, 6 +
 * craftTool skill bug). Pins the four fixes:
 *
 *   Fix 1 — a completed craft (executeCraft AND craftTool) records a 'craft'
 *           transaction into world_market (supply −qty, demand +qty); the
 *           previously-defined-but-never-invoked type. Non-blocking: an absent
 *           world_market table still crafts ok.
 *   Fix 2 — content/items.json expands 3 → 11 authored materials; each passes
 *           validateItemBlueprint and seedItemBlueprints upserts them into
 *           resource_properties (propsFor returns the authored values).
 *   Fix 3 — TOOL_RECIPES gains 6 recipes filling the 30→100 / 120→500
 *           progression cliffs; unique ids, valid schema, craftable end-to-end.
 *   Fix 4 — craftTool reads the real 'crafting' skill from player_skill_levels
 *           (floored at the legacy tool-tier proxy) so a skilled player crafts a
 *           strictly better tool; a player with no skill rows (or a build with
 *           no player_skill_levels table) falls back to the proxy without throwing.
 *
 * Run: node --test tests/tool-tree-craft.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { executeCraft } from "../lib/crafting/craft-engine.js";
import {
  seedResourceProperties,
  seedItemBlueprints,
  validateItemBlueprint,
  propsFor,
} from "../lib/resources.js";
import { resolveCraft } from "../lib/craft-resolve.js";
import { TOOL_RECIPES, seedToolRecipes, craftTool } from "../lib/tool-tree.js";

const WORLD = "concordia-hub";
const USER = "user_tt";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ITEMS = JSON.parse(readFileSync(join(__dirname, "../../content/items.json"), "utf8"));

// ── shared schema fragments ──────────────────────────────────────────────────
const RESOURCE_PROPS_DDL = `
  CREATE TABLE resource_properties (
    item_id TEXT PRIMARY KEY, potency INTEGER, affinity TEXT, stability INTEGER,
    volume REAL, weight REAL, rarity_tier INTEGER, source_type TEXT, magical_sub TEXT,
    updated_at INTEGER DEFAULT (unixepoch())
  );`;
const WORLD_MARKET_DDL = `
  CREATE TABLE world_market (
    id TEXT PRIMARY KEY, world_id TEXT, resource_id TEXT, base_price INTEGER,
    current_price INTEGER, supply_count INTEGER, demand_count INTEGER, last_updated INTEGER
  );`;
const PLAYER_INV_DDL = `
  CREATE TABLE player_inventory (
    id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT DEFAULT 'concordia-hub',
    item_type TEXT, item_id TEXT, item_name TEXT, quantity INTEGER DEFAULT 1,
    quality TEXT, acquired_at INTEGER DEFAULT (unixepoch()), properties_json TEXT
  );`;

function giveInv(db, itemId, qty, propsJson = null) {
  db.prepare(`INSERT INTO player_inventory (id, user_id, world_id, item_type, item_id, item_name, quantity, properties_json)
              VALUES (?, ?, ?, 'material', ?, ?, ?, ?)`)
    .run(`inv_${itemId}_${Math.random()}`, USER, WORLD, itemId, itemId, qty, propsJson);
}
function seedMarketRow(db, resourceId, { supply = 200, demand = 10, base = 10 } = {}) {
  db.prepare(`INSERT INTO world_market (id, world_id, resource_id, base_price, current_price, supply_count, demand_count, last_updated)
              VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`)
    .run(`mk_${resourceId}`, WORLD, resourceId, base, base, supply, demand);
}

// ── executeCraft DB (with world_market) ──────────────────────────────────────
function makeCraftDb({ withMarket = true, craftingLevel = 60 } = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (id TEXT PRIMARY KEY, world_type TEXT, rule_modulators TEXT);
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY, creator_id TEXT, type TEXT, title TEXT,
      data TEXT, skill_level INTEGER, created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE player_skill_levels (
      id TEXT PRIMARY KEY, user_id TEXT, skill_type TEXT, native_world_type TEXT,
      level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, xp_to_next INTEGER DEFAULT 100,
      last_used_at INTEGER DEFAULT (unixepoch()), UNIQUE(user_id, skill_type, native_world_type)
    );
    ${PLAYER_INV_DDL}
    CREATE TABLE user_active_effects (
      id TEXT PRIMARY KEY, user_id TEXT, effect_id TEXT, kind TEXT, magnitude REAL,
      source_dtu_id TEXT, started_at INTEGER DEFAULT (unixepoch()), expires_at INTEGER
    );
    ${RESOURCE_PROPS_DDL}
    ${withMarket ? WORLD_MARKET_DDL : ""}
  `);
  db.prepare("INSERT INTO worlds (id, world_type, rule_modulators) VALUES (?, 'standard', '{}')").run(WORLD);
  db.prepare(`INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level)
              VALUES ('s1', ?, 'crafting', 'standard', ?)`).run(USER, craftingLevel);
  seedResourceProperties(db);
  return db;
}
let _rid = 0;
function makeRecipe(db, resources) {
  const id = `recipe_${++_rid}`;
  const data = {
    spec: { name: "Test Blade", output_type: "weapon", output_subtype: "sword" },
    resource_requirements: resources.map((r) => ({ resource_id: r.itemId, quantity: r.qty })),
    skill_requirements: [],
    output_type: "weapon",
  };
  db.prepare(`INSERT INTO dtus (id, creator_id, type, title, data, skill_level)
              VALUES (?, 'system', 'recipe', 'Test Blade', ?, 0)`).run(id, JSON.stringify(data));
  return id;
}

// ── craftTool DB ─────────────────────────────────────────────────────────────
function makeToolDb({ withMarket = true, withSkillTable = true } = {}) {
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
    ${PLAYER_INV_DDL}
    CREATE TABLE dtus (id TEXT PRIMARY KEY, owner_user_id TEXT, skill_level INTEGER, tags_json TEXT);
    ${RESOURCE_PROPS_DDL}
    ${withMarket ? WORLD_MARKET_DDL : ""}
    ${withSkillTable ? `CREATE TABLE player_skill_levels (
      id TEXT PRIMARY KEY, user_id TEXT, skill_type TEXT, native_world_type TEXT,
      level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, xp_to_next INTEGER DEFAULT 100,
      last_used_at INTEGER DEFAULT (unixepoch()), UNIQUE(user_id, skill_type, native_world_type)
    );` : ""}
  `);
  seedToolRecipes(db);
  seedResourceProperties(db);
  return db;
}
function toolRecipeConsuming(db, id, materialId, baseQuality, qty = 2) {
  db.prepare(`INSERT INTO tool_recipes (id, name, description, tier, required_tool_tier, required_skill_level, materials_json, output_quality)
              VALUES (?, ?, '', 1, -1, 0, ?, ?)`)
    .run(id, id, JSON.stringify([{ id: materialId, quantity: qty }]), baseQuality);
}
function setCraftingSkill(db, level) {
  db.prepare(`INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level)
              VALUES (?, ?, 'crafting', 'standard', ?)`).run(`sk_${Math.random()}`, USER, level);
}
function giveTool(db, recipeId, tier, quality = 50) {
  db.prepare(`INSERT INTO tool_recipes (id, name, description, tier, required_tool_tier, required_skill_level, materials_json, output_quality)
              VALUES (?, ?, '', ?, -1, 0, '[]', ?)`).run(recipeId, recipeId, tier, quality);
  db.prepare(`INSERT INTO player_tools (id, user_id, recipe_id, quality) VALUES (?, ?, ?, ?)`)
    .run(`pt_${Math.random()}`, USER, recipeId, quality);
}

// ── Fix 1 — executeCraft records a 'craft' world_market transaction ──────────
describe("Fix 1 — executeCraft wires into world_market", () => {
  it("drops supply and raises demand for the consumed resource", () => {
    const db = makeCraftDb();
    seedMarketRow(db, "iron_ingot", { supply: 200, demand: 10 });
    giveInv(db, "iron_ingot", 2);
    const r = executeCraft(db, USER, WORLD, makeRecipe(db, [{ itemId: "iron_ingot", qty: 2 }]));
    assert.equal(r.ok, true);
    const row = db.prepare("SELECT supply_count, demand_count FROM world_market WHERE world_id=? AND resource_id='iron_ingot'").get(WORLD);
    assert.equal(row.supply_count, 198, "supply dropped by qty");
    assert.equal(row.demand_count, 12, "demand rose by qty");
  });

  it("still crafts ok when world_market is absent (non-blocking)", () => {
    const db = makeCraftDb({ withMarket: false });
    giveInv(db, "iron_ingot", 2);
    const r = executeCraft(db, USER, WORLD, makeRecipe(db, [{ itemId: "iron_ingot", qty: 2 }]));
    assert.equal(r.ok, true);
    assert.ok(r.dtu, "output DTU produced");
  });
});

// ── Fix 1 — craftTool records a 'craft' world_market transaction ─────────────
describe("Fix 1 — craftTool wires into world_market", () => {
  it("drops supply and raises demand for each consumed material", () => {
    const db = makeToolDb();
    seedMarketRow(db, "iron_ingot", { supply: 200, demand: 10 });
    toolRecipeConsuming(db, "tt_axe", "iron_ingot", 50, 3);
    giveInv(db, "iron_ingot", 3);
    const r = craftTool(db, USER, "tt_axe", WORLD);
    assert.equal(r.ok, true);
    const row = db.prepare("SELECT supply_count, demand_count FROM world_market WHERE world_id=? AND resource_id='iron_ingot'").get(WORLD);
    assert.equal(row.supply_count, 197);
    assert.equal(row.demand_count, 13);
  });

  it("still crafts ok when world_market is absent (non-blocking)", () => {
    const db = makeToolDb({ withMarket: false });
    toolRecipeConsuming(db, "tt_axe2", "iron_ingot", 50);
    giveInv(db, "iron_ingot", 2);
    const r = craftTool(db, USER, "tt_axe2", WORLD);
    assert.equal(r.ok, true);
    assert.ok(r.tool);
  });
});

// ── Fix 4 — craftTool reads the real crafting skill ──────────────────────────
describe("Fix 4 — craftTool uses the real 'crafting' skill (floored at proxy)", () => {
  it("a skilled crafter produces a strictly better tool than one with no skill", () => {
    const dbSkilled = makeToolDb();
    setCraftingSkill(dbSkilled, 90);
    toolRecipeConsuming(dbSkilled, "steel_axe", "steel_ingot", 50);
    giveInv(dbSkilled, "steel_ingot", 2);
    const skilled = craftTool(dbSkilled, USER, "steel_axe", WORLD);

    const dbNovice = makeToolDb();
    toolRecipeConsuming(dbNovice, "steel_axe", "steel_ingot", 50);
    giveInv(dbNovice, "steel_ingot", 2);
    const novice = craftTool(dbNovice, USER, "steel_axe", WORLD);

    assert.equal(skilled.ok, true);
    assert.equal(novice.ok, true);
    assert.ok(
      skilled.tool.quality > novice.tool.quality,
      `skilled ${skilled.tool.quality} !> novice ${novice.tool.quality}`,
    );
  });

  it("no skill rows + a tier-2 tool falls back to the legacy tier×20 proxy", () => {
    const db = makeToolDb();
    giveTool(db, "owned_t2", 2);           // getPlayerToolTier → 2 → proxy skill 40
    toolRecipeConsuming(db, "proxy_axe", "steel_ingot", 50);
    giveInv(db, "steel_ingot", 2);
    const r = craftTool(db, USER, "proxy_axe", WORLD);
    assert.equal(r.ok, true);
    // Expected = the pre-fix proxy behaviour: resolveCraft at skill = tier×20 = 40.
    const expected = Math.round(50 * resolveCraft({
      inputs: [{ itemId: "steel_ingot", qty: 2 }], playerSkill: 40, stationQuality: 0,
    }).qualityMultiplier);
    assert.equal(r.tool.quality, expected, "no crafting skill → identical to proxy");
  });

  it("a missing player_skill_levels table does not throw (falls back to proxy)", () => {
    const db = makeToolDb({ withSkillTable: false });
    toolRecipeConsuming(db, "noskill_axe", "steel_ingot", 50);
    giveInv(db, "steel_ingot", 2);
    const r = craftTool(db, USER, "noskill_axe", WORLD);
    assert.equal(r.ok, true);
    const expected = Math.round(50 * resolveCraft({
      inputs: [{ itemId: "steel_ingot", qty: 2 }], playerSkill: 0, stationQuality: 0,
    }).qualityMultiplier);
    assert.equal(r.tool.quality, expected);
  });
});

// ── Fix 2 — content/items.json expansion ─────────────────────────────────────
describe("Fix 2 — content/items.json authored materials", () => {
  it("has 11 entries, all passing validateItemBlueprint", () => {
    assert.equal(ITEMS.length, 11, "3 original + 8 new");
    for (const it of ITEMS) {
      assert.equal(validateItemBlueprint(it).ok, true, `${it.item_id} should validate`);
    }
    // unique ids
    assert.equal(new Set(ITEMS.map((i) => i.item_id)).size, ITEMS.length, "unique item_ids");
    // all 5 affinities represented across the set
    const affinities = new Set(ITEMS.map((i) => i.affinity));
    for (const a of ["magic", "tech", "bio", "physical", "chaos"]) {
      assert.ok(affinities.has(a), `affinity ${a} represented`);
    }
  });

  it("seedItemBlueprints upserts all 11 and propsFor returns the authored values", () => {
    const db = new Database(":memory:");
    db.exec(RESOURCE_PROPS_DDL);
    const n = seedItemBlueprints(db, ITEMS);
    assert.equal(n, 11);
    const p = propsFor("founders_quench", { db });
    assert.equal(p.potency, 88);
    assert.equal(p.affinity, "physical");
    assert.equal(p.stability, 94);
    assert.equal(p.rarity_tier, 5);
    // the two ids referenced by the new tool recipes exist as real materials
    assert.equal(propsFor("hushvein_silver", { db }).affinity, "magic");
    assert.equal(propsFor("first_dawn_amber", { db }).magical_sub, "essence");
  });
});

// ── Fix 3 — TOOL_RECIPES expansion ───────────────────────────────────────────
describe("Fix 3 — TOOL_RECIPES progression fills", () => {
  it("all recipes have unique ids and valid parseable schema", () => {
    assert.equal(new Set(TOOL_RECIPES.map((r) => r.id)).size, TOOL_RECIPES.length, "unique ids");
    for (const r of TOOL_RECIPES) {
      assert.equal(typeof r.id, "string");
      assert.ok(Number.isFinite(r.tier));
      assert.ok(Number.isFinite(r.required_skill_level));
      assert.ok(Number.isFinite(r.output_quality));
      const mats = JSON.parse(r.materials_json);
      assert.ok(Array.isArray(mats));
      for (const m of mats) {
        assert.equal(typeof m.id, "string");
        assert.ok(Number.isFinite(m.quantity) && m.quantity > 0);
      }
    }
  });

  it("the 6 new recipes are present and gate the intended cliffs", () => {
    const byId = Object.fromEntries(TOOL_RECIPES.map((r) => [r.id, r]));
    for (const id of [
      "recipe_tanning_rack", "recipe_smelters_crucible", "recipe_masterwork_anvil",
      "recipe_enchanters_burin", "recipe_arcane_lathe", "recipe_refusal_edgeworks",
    ]) {
      assert.ok(byId[id], `${id} present`);
    }
    assert.equal(byId.recipe_masterwork_anvil.required_skill_level, 60);   // 30→100 bridge
    assert.equal(byId.recipe_arcane_lathe.required_skill_level, 250);      // 120→500 bridge
    assert.equal(byId.recipe_refusal_edgeworks.required_skill_level, 500); // second legendary
  });

  it("a new recipe is craftable end-to-end when its materials are granted", () => {
    const db = makeToolDb();
    // tanning rack: skill 0, tool tier 0 — the survival-path entry, no gate.
    giveInv(db, "wood", 4);
    giveInv(db, "hide", 3);
    const r = craftTool(db, USER, "recipe_tanning_rack", WORLD);
    assert.equal(r.ok, true);
    assert.ok(r.tool.quality > 0);
    // materials consumed
    const wood = db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM player_inventory WHERE user_id=? AND item_id='wood'").get(USER).n;
    assert.equal(wood, 0);
  });
});
