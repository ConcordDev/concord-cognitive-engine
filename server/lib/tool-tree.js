// @sql-loop-ok: tool craft consumes recipe materials with per-material
// quantity (typical recipe: 2-5 materials). Per-row UPDATE/DELETE is bounded.
// server/lib/tool-tree.js
// Tool tier progression system. Players start at Tier 0 and must craft their way up.
// Higher tiers require: previous-tier tool + minimum skill level + gathered materials.

import crypto from "crypto";
import { resolveCraft } from "./craft-resolve.js";

// Hard-coded tool recipe tree seeded once at startup.
export const TOOL_RECIPES = [
  // ── Tier 0 — always available (no tool required) ────────────────────────
  {
    id: "recipe_bare_hands",
    name: "Bare Hands",
    description: "Your default tool. Can gather soft materials and shape clay.",
    tier: 0,
    required_tool_tier: -1, // always available
    required_skill_level: 0,
    materials_json: "[]",
    output_quality: 10,
  },
  {
    id: "recipe_sharp_rock",
    name: "Sharp Rock",
    description: "A naturally sharp stone. Scrapes wood and cuts soft materials.",
    tier: 0,
    required_tool_tier: -1,
    required_skill_level: 0,
    materials_json: JSON.stringify([{ id: "stone", quantity: 1 }]),
    output_quality: 15,
  },

  // ── Tier 1 — basic tools (requires Tier 0 + basic materials) ────────────
  {
    id: "recipe_crude_hammer",
    name: "Crude Hammer",
    description: "A stone head bound to a wooden stick. Can shape stone and timber.",
    tier: 1,
    required_tool_tier: 0,
    required_skill_level: 0,
    materials_json: JSON.stringify([
      { id: "stone", quantity: 3 },
      { id: "wood", quantity: 2 },
    ]),
    output_quality: 30,
  },
  {
    id: "recipe_stone_chisel",
    name: "Stone Chisel",
    description: "Allows precise carving of stone and shaping of brickwork.",
    tier: 1,
    required_tool_tier: 0,
    required_skill_level: 0,
    materials_json: JSON.stringify([
      { id: "stone", quantity: 4 },
      { id: "wood", quantity: 1 },
    ]),
    output_quality: 30,
  },
  {
    id: "recipe_clay_mold",
    name: "Clay Mold",
    description: "Cast basic shapes from molten material.",
    tier: 1,
    required_tool_tier: 0,
    required_skill_level: 0,
    materials_json: JSON.stringify([{ id: "clay", quantity: 5 }]),
    output_quality: 25,
  },

  // ── Tier 2 — crafted tools (requires Tier 1 + ore + skill ≥ 25) ─────────
  {
    id: "recipe_iron_hammer",
    name: "Iron Hammer",
    description: "Forged iron head. Shapes metal, stone, and dense timber precisely.",
    tier: 2,
    required_tool_tier: 1,
    required_skill_level: 25,
    materials_json: JSON.stringify([
      { id: "iron_ore", quantity: 5 },
      { id: "wood", quantity: 2 },
      { id: "coal", quantity: 2 },
    ]),
    output_quality: 55,
  },
  {
    id: "recipe_precision_measure",
    name: "Precision Measure",
    description: "Iron calipers and ruler set. Required for structural and mechanical specs.",
    tier: 2,
    required_tool_tier: 1,
    required_skill_level: 25,
    materials_json: JSON.stringify([
      { id: "iron_ore", quantity: 3 },
      { id: "glass", quantity: 1 },
    ]),
    output_quality: 55,
  },
  {
    id: "recipe_kiln",
    name: "Kiln",
    description: "A fired clay kiln. Unlocks ceramic, fired brick, and smelting.",
    tier: 2,
    required_tool_tier: 1,
    required_skill_level: 30,
    materials_json: JSON.stringify([
      { id: "clay", quantity: 20 },
      { id: "stone", quantity: 10 },
      { id: "coal", quantity: 5 },
    ]),
    output_quality: 60,
  },

  // ── Tier 3 — advanced tools (requires Tier 2 + rare materials + skill ≥ 100) ─
  {
    id: "recipe_power_tools",
    name: "Power Tool Set",
    description: "Electric drill, jigsaw, lathe. Enables complex mechanical and electrical specs.",
    tier: 3,
    required_tool_tier: 2,
    required_skill_level: 100,
    materials_json: JSON.stringify([
      { id: "steel", quantity: 10 },
      { id: "copper_wire", quantity: 5 },
      { id: "rubber", quantity: 3 },
    ]),
    output_quality: 80,
  },
  {
    id: "recipe_laser_cutter",
    name: "Laser Cutter",
    description: "Precision laser fabrication. Required for advanced materials and electronics.",
    tier: 3,
    required_tool_tier: 2,
    required_skill_level: 120,
    materials_json: JSON.stringify([
      { id: "steel", quantity: 8 },
      { id: "lens_crystal", quantity: 2 },
      { id: "copper_wire", quantity: 8 },
    ]),
    output_quality: 85,
  },

  // ── Tier 4 — legendary (requires Tier 3 + Legendary skill ≥ 500) ────────
  {
    id: "recipe_legendary_forge",
    name: "Legendary Forge",
    description: "A master craftsman's forge. Produces masterwork items of any complexity.",
    tier: 4,
    required_tool_tier: 3,
    required_skill_level: 500,
    materials_json: JSON.stringify([
      { id: "mythril_ore", quantity: 10 },
      { id: "dragon_stone", quantity: 3 },
      { id: "steel", quantity: 20 },
    ]),
    output_quality: 100,
  },
];

/**
 * Seed tool recipes into the DB on first startup.
 */
export function seedToolRecipes(db) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO tool_recipes
      (id, name, description, tier, required_tool_tier, required_skill_level, materials_json, output_quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of TOOL_RECIPES) {
    insert.run(r.id, r.name, r.description, r.tier, r.required_tool_tier, r.required_skill_level, r.materials_json, r.output_quality);
  }
}

/**
 * Get all tools owned by a player, with their recipe details.
 */
export function getPlayerTools(db, userId) {
  return db.prepare(`
    SELECT pt.*, tr.name, tr.tier, tr.output_quality, tr.description
    FROM player_tools pt
    JOIN tool_recipes tr ON tr.id = pt.recipe_id
    WHERE pt.user_id = ?
    ORDER BY tr.tier ASC
  `).all(userId);
}

/**
 * Get the highest tool tier a player currently owns.
 * Returns 0 if they only have bare hands (Tier 0 is always assumed).
 */
export function getPlayerToolTier(db, userId) {
  const row = db.prepare(`
    SELECT MAX(tr.tier) AS max_tier
    FROM player_tools pt
    JOIN tool_recipes tr ON tr.id = pt.recipe_id
    WHERE pt.user_id = ?
  `).get(userId);
  return row?.max_tier ?? 0;
}

/**
 * Get the best tool quality the player has at a given tier.
 */
export function getBestToolQuality(db, userId, tier) {
  const row = db.prepare(`
    SELECT MAX(pt.quality) AS best_quality
    FROM player_tools pt
    JOIN tool_recipes tr ON tr.id = pt.recipe_id
    WHERE pt.user_id = ? AND tr.tier = ?
  `).get(userId, tier);
  return row?.best_quality ?? 10; // bare hands baseline
}

/**
 * Attempt to craft a tool.
 * Validates: tool tier requirement, skill level, and materials in inventory.
 * Returns { ok, tool } or { ok: false, error }.
 */
export function craftTool(db, userId, recipeId, worldId = "concordia-hub") {
  const recipe = db.prepare(`SELECT * FROM tool_recipes WHERE id = ?`).get(recipeId);
  if (!recipe) return { ok: false, error: "recipe_not_found" };

  // Check tool tier prerequisite
  if (recipe.required_tool_tier > 0) {
    const currentTier = getPlayerToolTier(db, userId);
    if (currentTier < recipe.required_tool_tier) {
      return { ok: false, error: "insufficient_tool_tier", required: recipe.required_tool_tier, current: currentTier };
    }
  }

  // Check skill level (look for any skill DTU owned by player)
  if (recipe.required_skill_level > 0) {
    const bestSkill = db.prepare(`
      SELECT MAX(skill_level) AS best FROM dtus
      WHERE owner_user_id = ? AND tags_json LIKE '%concordia%'
    `).get(userId);
    if ((bestSkill?.best ?? 1) < recipe.required_skill_level) {
      return {
        ok: false,
        error: "insufficient_skill",
        required: recipe.required_skill_level,
        current: bestSkill?.best ?? 1,
      };
    }
  }

  // Check inventory materials. Inventory is USER-GLOBAL ("one universe, many
  // worlds" — the Concord Link carries your inventory between worlds), so a
  // craft draws from the player's single global stock regardless of which world
  // they're standing in. The PK (user_id, item_id) guarantees one row per
  // material, so dropping the world_id filter consumes the right stack.
  const materials = JSON.parse(recipe.materials_json);
  if (materials.length > 0) {
    for (const mat of materials) {
      const inv = db.prepare(`
        SELECT SUM(quantity) AS qty FROM player_inventory
        WHERE user_id = ? AND item_id = ?
      `).get(userId, mat.id);
      if ((inv?.qty ?? 0) < mat.quantity) {
        return { ok: false, error: "missing_material", material: mat.id, needed: mat.quantity, have: inv?.qty ?? 0 };
      }
    }

    // Consume materials
    for (const mat of materials) {
      db.prepare(`
        UPDATE player_inventory SET quantity = quantity - ?
        WHERE user_id = ? AND item_id = ?
      `).run(mat.quantity, userId, mat.id);
      db.prepare(`DELETE FROM player_inventory WHERE user_id = ? AND item_id = ? AND quantity <= 0`).run(userId, mat.id);
    }
  }

  // Living Society P0 — derive the tool's quality from the consumed materials'
  // resource PROPERTIES (the same single craft-resolve layer executeCraft uses)
  // instead of trusting the recipe's flat output_quality. Stronger mats →
  // better tool. Tool-crafting is the basic survival path, so the soft-fail
  // here only scales quality down (never blocks, never debuffs). Kill-switch
  // CONCORD_CRAFT_RESOLVE=0 restores the flat scalar.
  let quality = recipe.output_quality;
  let resolved = null;
  if (process.env.CONCORD_CRAFT_RESOLVE !== "0" && materials.length > 0) {
    try {
      const playerSkill = Math.min(100, getPlayerToolTier(db, userId) * 20);
      resolved = resolveCraft({
        inputs: materials.map((m) => ({ itemId: m.id, qty: Math.max(1, Number(m.quantity) || 1) })),
        playerSkill,
        stationQuality: 0,
        db,
      });
      if (resolved?.ok) {
        // qualityMultiplier ∈ [0.5, 2.0] centred ~1.0 → scale the base quality.
        quality = Math.round(recipe.output_quality * resolved.qualityMultiplier);
      }
    } catch { resolved = null; }
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO player_tools (id, user_id, recipe_id, quality)
    VALUES (?, ?, ?, ?)
  `).run(id, userId, recipeId, quality);

  const tool = { id, recipeId, name: recipe.name, tier: recipe.tier, quality };
  if (resolved?.ok) {
    tool.resource_affinity = resolved.outputAffinity;
    tool.resource_potency = resolved.outputPotency;
  }
  return { ok: true, tool };
}
