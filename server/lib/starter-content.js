/**
 * Starter content seed — runs once at boot. Provides the minimum set of
 * world content a new player needs to actually play:
 *
 *   • 12 starter crafting recipes covering tier-1 weapons, tools, and
 *     consumables (so a new player can craft something on day one).
 *   • 6 hostile creature spawns in the frontier district (so the player
 *     has something to fight without waiting for emergent encounters).
 *   • Starting inventory granted to first-login users (50 wood, 30 stone,
 *     20 fiber, 5 iron-ore) so they can immediately craft.
 *
 * Idempotent: each seed checks for existing rows / DTUs by stable id and
 * skips if already present.
 */

const STARTER_RECIPES = [
  {
    id: "recipe_wooden_sword",
    title: "Wooden Sword",
    category: "weapon",
    output: { name: "Wooden Sword", type: "weapon", quality: "tier_1", damage: 12 },
    ingredients: [
      { type: "wood",  quantity: 5,  name: "Wood" },
      { type: "fiber", quantity: 2,  name: "Fiber (binding)" },
    ],
    durationMs: 5_000,
  },
  {
    id: "recipe_stone_pickaxe",
    title: "Stone Pickaxe",
    category: "tool",
    output: { name: "Stone Pickaxe", type: "tool", quality: "tier_1", gatherBonus: 1.5 },
    ingredients: [
      { type: "wood",  quantity: 3, name: "Wood" },
      { type: "stone", quantity: 4, name: "Stone" },
    ],
    durationMs: 4_000,
  },
  {
    id: "recipe_iron_dagger",
    title: "Iron Dagger",
    category: "weapon",
    output: { name: "Iron Dagger", type: "weapon", quality: "tier_2", damage: 18 },
    ingredients: [
      { type: "iron_ore", quantity: 3, name: "Iron Ore" },
      { type: "wood",     quantity: 2, name: "Wood (handle)" },
    ],
    durationMs: 8_000,
  },
  {
    id: "recipe_iron_axe",
    title: "Iron Axe",
    category: "tool",
    output: { name: "Iron Axe", type: "tool", quality: "tier_2", gatherBonus: 2.0 },
    ingredients: [
      { type: "iron_ore", quantity: 4, name: "Iron Ore" },
      { type: "wood",     quantity: 3, name: "Wood" },
    ],
    durationMs: 9_000,
  },
  {
    id: "recipe_health_poultice",
    title: "Health Poultice",
    category: "consumable",
    output: { name: "Health Poultice", type: "consumable", quality: "tier_1", healAmount: 30 },
    ingredients: [
      { type: "fiber",      quantity: 3, name: "Fiber" },
      { type: "herb_green", quantity: 2, name: "Green Herb" },
    ],
    durationMs: 3_000,
  },
  {
    id: "recipe_stamina_brew",
    title: "Stamina Brew",
    category: "consumable",
    output: { name: "Stamina Brew", type: "consumable", quality: "tier_1", staminaAmount: 40 },
    ingredients: [
      { type: "herb_blue",  quantity: 2, name: "Blue Herb" },
      { type: "water",      quantity: 1, name: "Clean Water" },
    ],
    durationMs: 3_000,
  },
  {
    id: "recipe_leather_chest",
    title: "Leather Cuirass",
    category: "armor",
    output: { name: "Leather Cuirass", type: "armor", quality: "tier_1", armorBonus: 8 },
    ingredients: [
      { type: "hide",  quantity: 4, name: "Hide" },
      { type: "fiber", quantity: 3, name: "Fiber" },
    ],
    durationMs: 6_000,
  },
  {
    id: "recipe_iron_chest",
    title: "Iron Chestplate",
    category: "armor",
    output: { name: "Iron Chestplate", type: "armor", quality: "tier_2", armorBonus: 18 },
    ingredients: [
      { type: "iron_ore", quantity: 6, name: "Iron Ore" },
      { type: "fiber",    quantity: 2, name: "Fiber" },
    ],
    durationMs: 12_000,
  },
  {
    id: "recipe_workbench",
    title: "Crafting Workbench",
    category: "structure",
    output: { name: "Workbench", type: "structure", quality: "tier_1" },
    ingredients: [
      { type: "wood",  quantity: 8, name: "Wood" },
      { type: "stone", quantity: 4, name: "Stone" },
    ],
    durationMs: 7_000,
  },
  {
    id: "recipe_torch",
    title: "Torch",
    category: "tool",
    output: { name: "Torch", type: "tool", quality: "tier_1" },
    ingredients: [
      { type: "wood",  quantity: 1, name: "Wood" },
      { type: "fiber", quantity: 1, name: "Fiber" },
    ],
    durationMs: 1_000,
  },
  {
    id: "recipe_journal",
    title: "Field Journal",
    category: "tool",
    output: { name: "Field Journal", type: "tool", quality: "tier_1", note: "Carries DTU citations between worlds." },
    ingredients: [
      { type: "fiber",      quantity: 4, name: "Fiber" },
      { type: "herb_green", quantity: 1, name: "Green Herb (ink)" },
    ],
    durationMs: 4_000,
  },
  {
    id: "recipe_iron_ingot",
    title: "Iron Ingot",
    category: "material",
    output: { name: "Iron Ingot", type: "material", quality: "tier_2" },
    ingredients: [
      { type: "iron_ore", quantity: 2, name: "Iron Ore" },
      { type: "wood",     quantity: 1, name: "Wood (fuel)" },
    ],
    durationMs: 6_000,
  },
];

const STARTER_INVENTORY = [
  { type: "wood",       quantity: 50, name: "Wood" },
  { type: "stone",      quantity: 30, name: "Stone" },
  { type: "fiber",      quantity: 20, name: "Fiber" },
  { type: "iron_ore",   quantity: 5,  name: "Iron Ore" },
  { type: "herb_green", quantity: 5,  name: "Green Herb" },
  { type: "herb_blue",  quantity: 5,  name: "Blue Herb" },
  { type: "water",      quantity: 5,  name: "Clean Water" },
];

// Hostile creatures: 6 spawns in frontier, 2 each at 3 elevations.
const STARTER_HOSTILES = [
  { id: "wraith_alpha",   archetype: "wraith",   level: 2, position: { x: 1500, y: 25, z: 1500 }, hp: 60,  damage: 8,  aggroRadius: 12 },
  { id: "wraith_beta",    archetype: "wraith",   level: 3, position: { x: 1520, y: 25, z: 1480 }, hp: 80,  damage: 10, aggroRadius: 12 },
  { id: "drift_eater_1",  archetype: "drift_eater", level: 5, position: { x: 1600, y: 30, z: 1600 }, hp: 140, damage: 18, aggroRadius: 18 },
  { id: "drift_eater_2",  archetype: "drift_eater", level: 5, position: { x: 1610, y: 30, z: 1620 }, hp: 140, damage: 18, aggroRadius: 18 },
  { id: "shard_husk_1",   archetype: "shard_husk",  level: 4, position: { x: 1700, y: 35, z: 1700 }, hp: 110, damage: 14, aggroRadius: 15 },
  { id: "shard_husk_2",   archetype: "shard_husk",  level: 4, position: { x: 1720, y: 35, z: 1680 }, hp: 110, damage: 14, aggroRadius: 15 },
];

const _seeded = { recipes: false, hostiles: false };

export function seedStarterRecipes(db, { systemUserId = "system_starter" } = {}) {
  if (_seeded.recipes) return { ok: true, count: 0, alreadySeeded: true };
  let count = 0;
  for (const r of STARTER_RECIPES) {
    try {
      const exists = db.prepare("SELECT id FROM dtus WHERE id = ?").get(r.id);
      if (exists) continue;
      db.prepare(`INSERT INTO dtus (id, type, title, creator_id, data, created_at)
                  VALUES (?, 'recipe', ?, ?, ?, ?)`)
        .run(r.id, r.title, systemUserId, JSON.stringify({
          category: r.category,
          ingredients: r.ingredients,
          output: r.output,
          durationMs: r.durationMs,
        }), Math.floor(Date.now() / 1000));
      count++;
    } catch (e) { /* table may not exist or schema mismatch — best-effort */ }
  }
  _seeded.recipes = true;
  return { ok: true, count, total: STARTER_RECIPES.length };
}

/**
 * Seed hostile NPCs directly into the world_npcs table so the existing
 * NPCSimulator picks them up on its next tick. The aggro-state machine
 * (alerted → pursuing → attacking) handles the rest — we only need to
 * make sure the row exists with an aggressive archetype.
 *
 * @param {object} db
 * @param {string} worldId
 * @returns {{ ok, count, total }}
 */
export function seedStarterHostiles(db, worldId = "concordia-hub") {
  if (_seeded.hostiles) return { ok: true, count: 0, alreadySeeded: true };
  if (!db) return { ok: false, error: "db_required", count: 0 };
  let count = 0;
  for (const h of STARTER_HOSTILES) {
    try {
      const exists = db.prepare("SELECT id FROM world_npcs WHERE id = ?").get(h.id);
      if (exists) continue;
      db.prepare(`INSERT INTO world_npcs
                  (id, world_id, npc_type, archetype, body_type, universe_type, faction,
                   is_conscious, is_immortal, quest_giver, level, current_hp, max_hp,
                   spawn_location, current_location, state)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          h.id, worldId,
          h.archetype, h.archetype, "humanoid", "frontier", "hostile",
          0, 0, 0,
          h.level, h.hp, h.hp,
          JSON.stringify(h.position),
          JSON.stringify(h.position),
          JSON.stringify({ name: h.archetype.replace(/_/g, " "), hostile: true }),
        );
      count++;
    } catch { /* row insert silent */ }
  }
  _seeded.hostiles = true;
  return { ok: true, count, total: STARTER_HOSTILES.length };
}

export function getStarterInventory() {
  return STARTER_INVENTORY.map(item => ({ ...item }));
}

export function getStarterRecipes() {
  return STARTER_RECIPES.slice();
}

export function getStarterHostiles() {
  return STARTER_HOSTILES.slice();
}

/**
 * Grant starting inventory to a brand-new user. Idempotent — checks the
 * user's current inventory rows and only adds resources they don't yet
 * have. Returns the granted item list.
 */
export function grantStarterInventoryToUser(db, userId) {
  if (!userId) return { ok: false, error: "user_id_required" };
  const granted = [];
  try {
    for (const item of STARTER_INVENTORY) {
      // Check if user has any rows for this resource type.
      const existing = db.prepare(`SELECT COUNT(*) as n FROM dtus
                                   WHERE creator_id = ?
                                     AND type = 'material'
                                     AND title = ?`).get(userId, item.name);
      if (existing && existing.n > 0) continue;
      // Insert N material DTUs.
      for (let i = 0; i < item.quantity; i++) {
        const id = `mat_${userId.slice(0, 8)}_${item.type}_${Date.now()}_${i}`;
        try {
          db.prepare(`INSERT INTO dtus (id, type, title, creator_id, data, created_at)
                      VALUES (?, 'material', ?, ?, ?, ?)`)
            .run(id, item.name, userId, JSON.stringify({ type: item.type, quantity: 1 }),
                 Math.floor(Date.now() / 1000));
        } catch { /* inventory row insertion silent */ }
      }
      granted.push(item);
    }
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
  return { ok: true, granted };
}
