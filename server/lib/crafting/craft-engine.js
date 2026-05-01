// server/lib/crafting/craft-engine.js
// Executes crafting: validates resources + skills, creates output DTU.

import crypto from 'node:crypto';
import {
  getPlayerSkills,
  getPlayerSkillLevel,
  gainSkillXP,
  canCreateSkillInWorld,
  computeSkillEffectiveness,
} from '../skills/skill-engine.js';
import { validateDesign, estimateStats } from './recipe-validator.js';

// ── executeCraft ──────────────────────────────────────────────────────────────

/**
 * Execute a crafting operation: check resources/skills, deduct inventory, create DTU.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {string} worldId
 * @param {string} recipeId  - DTU id of type 'recipe'
 * @param {object} [opts]
 * @returns {{ ok: boolean, dtu?: object, itemAdded?: boolean, error?: string, missing_resources?: object[], missing_skills?: object[] }}
 */
export function executeCraft(db, userId, worldId, recipeId, opts = {}) {
  // 1. Load recipe DTU
  const recipeDtu = db.prepare("SELECT * FROM dtus WHERE id = ? AND type = 'recipe'").get(recipeId);
  if (!recipeDtu) {
    return { ok: false, error: 'Recipe not found or is not a recipe DTU' };
  }

  // 2. Parse recipe data
  const recipeData = _parseJSON(recipeDtu.data, {});
  if (!recipeData.spec) {
    return { ok: false, error: 'Recipe has no spec — it may be malformed' };
  }

  // 3. Load world rule_modulators
  const world = db.prepare("SELECT * FROM worlds WHERE id = ?").get(worldId);
  if (!world) {
    return { ok: false, error: 'World not found' };
  }
  const worldType = world.world_type || recipeData.world_type || 'standard';
  const worldRules = _parseJSON(world.rule_modulators, {});

  // 4. Get player skills
  const playerSkills = getPlayerSkills(db, userId);

  // 5. Validate all skill requirements
  const missingSkills = [];
  const skillRequirements = recipeData.skill_requirements || [];
  for (const req of skillRequirements) {
    const nativeLevel = _bestSkillLevel(playerSkills, req.skill_type);
    const eff = computeSkillEffectiveness(req.skill_type, nativeLevel, worldRules);
    if (!eff.effective || eff.effectiveLevel < req.level) {
      missingSkills.push({
        skill_type: req.skill_type,
        required_level: req.level,
        player_level: nativeLevel,
        effective_level: eff.effectiveLevel,
        reason: eff.reason,
      });
    }
  }

  if (missingSkills.length > 0) {
    return { ok: false, error: 'Insufficient skill levels', missing_skills: missingSkills };
  }

  // 6. Check each resource requirement against player_inventory
  const resourceRequirements = recipeData.resource_requirements || [];
  const missingResources = [];

  for (const req of resourceRequirements) {
    const row = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) AS total
      FROM player_inventory
      WHERE user_id = ? AND item_id = ?
    `).get(userId, req.resource_id);

    const available = row?.total ?? 0;
    if (available < req.quantity) {
      missingResources.push({
        resource_id: req.resource_id,
        required: req.quantity,
        available,
        shortage: req.quantity - available,
      });
    }
  }

  if (missingResources.length > 0) {
    return { ok: false, error: 'Insufficient resources', missing_resources: missingResources };
  }

  // 7. All checks passed — wrap in a transaction
  let resultDtu = null;
  let itemAdded = false;

  db.transaction(() => {
    // 8. Deduct resources from player_inventory (slot-by-slot, oldest first)
    for (const req of resourceRequirements) {
      let remaining = req.quantity;
      const slots = db.prepare(`
        SELECT * FROM player_inventory
        WHERE user_id = ? AND item_id = ?
        ORDER BY acquired_at ASC
      `).all(userId, req.resource_id);

      for (const slot of slots) {
        if (remaining <= 0) break;
        if (slot.quantity <= remaining) {
          db.prepare('DELETE FROM player_inventory WHERE id = ?').run(slot.id);
          remaining -= slot.quantity;
        } else {
          db.prepare('UPDATE player_inventory SET quantity = quantity - ? WHERE id = ?').run(remaining, slot.id);
          remaining = 0;
        }
      }
    }

    // 9. Create output DTU
    const playerCraftingLevel = _bestSkillLevel(playerSkills, 'crafting');
    const spec = recipeData.spec || {};
    const outputData = {
      crafted_in_world: worldId,
      recipe_id: recipeId,
      stats: estimateStats(spec, playerSkills, worldRules),
      enchantments: spec.enchantments || [],
      properties: spec.properties || {},
    };

    const dtuId = crypto.randomUUID();
    const outputType = recipeData.output_type || spec.output_type || 'item';
    const dtuName = recipeDtu.name || spec.name || 'Crafted Item';

    db.prepare(`
      INSERT INTO dtus (id, creator_id, type, name, data, skill_level)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(dtuId, userId, outputType, dtuName, JSON.stringify(outputData), playerCraftingLevel);

    resultDtu = { id: dtuId, creator_id: userId, type: outputType, name: dtuName, data: outputData, skill_level: playerCraftingLevel };

    // 11. If the output is a physical item, also add to player_inventory
    const PHYSICAL_OUTPUT_TYPES = ['item', 'weapon', 'armor', 'tool', 'consumable'];
    if (PHYSICAL_OUTPUT_TYPES.includes(outputType) || spec.output_type === 'item') {
      const invId = crypto.randomUUID();
      const subtype = spec.output_subtype || outputType;
      db.prepare(`
        INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, quality, acquired_at)
        VALUES (?, ?, ?, ?, ?, 1, 'crafted', unixepoch())
      `).run(invId, userId, subtype, dtuId, dtuName);
      itemAdded = true;
    }
  })();

  // 10. Gain XP on crafting skill
  const recipeComplexity = (recipeData.skill_requirements || []).length;
  gainSkillXP(db, userId, 'crafting', worldType, 50 + recipeComplexity * 10);

  // Also gain XP on any primary skill used (magic for spells, alchemy for potions, etc.)
  const primarySkillMap = {
    spell:    'magic',
    potion:   'alchemy',
    gadget:   'engineering',
    explosive:'engineering',
  };
  const subtype = recipeData.spec?.output_subtype || recipeData.output_type;
  if (primarySkillMap[subtype]) {
    gainSkillXP(db, userId, primarySkillMap[subtype], worldType, 25);
  }

  return { ok: true, dtu: resultDtu, itemAdded };
}

// ── createSkillDTU ────────────────────────────────────────────────────────────

/**
 * Create a user-designed spell or ability as a DTU.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {string} worldId
 * @param {string} worldType
 * @param {object} spec - { name, output_type: 'spell'|'ability', output_subtype, enchantments, properties, skill_type }
 * @returns {{ ok: boolean, dtu?: object, error?: string }}
 */
export function createSkillDTU(db, userId, worldId, worldType, spec) {
  // Validate the skill can exist in this world
  const skillType = spec.skill_type || spec.output_subtype || spec.output_type;
  const worldCheck = canCreateSkillInWorld(skillType, worldType);
  if (!worldCheck.ok) {
    return { ok: false, error: worldCheck.reason };
  }

  // Check the player has the base skill level required
  const playerLevel = getPlayerSkillLevel(db, userId, skillType);
  const world = db.prepare("SELECT rule_modulators FROM worlds WHERE id = ?").get(worldId);
  const worldRules = world ? _parseJSON(world.rule_modulators, {}) : {};
  const eff = computeSkillEffectiveness(skillType, playerLevel, worldRules);

  if (!eff.effective) {
    return { ok: false, error: eff.reason || `Skill '${skillType}' is not effective in this world` };
  }

  const MIN_LEVEL_FOR_SKILL_DTU = 5;
  if (eff.effectiveLevel < MIN_LEVEL_FOR_SKILL_DTU) {
    return {
      ok: false,
      error: `Effective skill level ${eff.effectiveLevel.toFixed(1)} is too low to create a ${spec.output_type} (minimum effective level: ${MIN_LEVEL_FOR_SKILL_DTU})`,
    };
  }

  // Create the DTU
  const dtuId = crypto.randomUUID();
  const outputType = spec.output_type === 'spell' ? 'spell' : 'ability';
  const dtuName = spec.name || `${skillType} ${outputType}`;
  const dtuData = {
    skill_type: skillType,
    world_type: worldType,
    created_in_world: worldId,
    enchantments: spec.enchantments || [],
    properties: spec.properties || {},
    spec,
  };

  db.prepare(`
    INSERT INTO dtus (id, creator_id, type, name, data, skill_level)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(dtuId, userId, outputType, dtuName, JSON.stringify(dtuData), playerLevel);

  const dtu = { id: dtuId, creator_id: userId, type: outputType, name: dtuName, data: dtuData, skill_level: playerLevel };
  return { ok: true, dtu };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _parseJSON(str, fallback) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

function _bestSkillLevel(playerSkills, skillType) {
  let best = 0;
  for (const s of (playerSkills || [])) {
    if (s.skill_type === skillType && s.level > best) best = s.level;
  }
  return best;
}
