// @sql-loop-ok: slot-by-slot resource consumption — each slot's
// remaining quantity depends on the previous slot's deduction. Loop is
// required for the slot-oldest-first invariant.
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
import { resolveCraft } from '../craft-resolve.js';

// ── Living Society P0 — resource-grounded quality ────────────────────────────────
//
// Build the resolveCraft input list from a recipe's resource_requirements.
// Each input carries the item id + needed quantity + (when present) the
// per-slot properties_json override on the oldest inventory slot the craft
// will actually consume — so an infused/crossbred mat (Phase 0.5 drop hook)
// resolves hotter than its kind baseline. Guarded: the properties_json column
// is migration-278 and may be absent on a minimal build.
function _craftInputsFromRecipe(db, userId, resourceRequirements) {
  const inputs = [];
  for (const req of resourceRequirements || []) {
    if (!req?.resource_id) continue;
    let overrideJson = null;
    try {
      const slot = db.prepare(`
        SELECT properties_json FROM player_inventory
        WHERE user_id = ? AND item_id = ? AND properties_json IS NOT NULL
        ORDER BY acquired_at ASC LIMIT 1
      `).get(userId, req.resource_id);
      overrideJson = slot?.properties_json || null;
    } catch { /* properties_json column absent — kind baseline */ }
    inputs.push({ itemId: req.resource_id, qty: Math.max(1, Number(req.quantity) || 1), overrideJson });
  }
  return inputs;
}

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

  // 6.5. Living Society P0 — derive output quality from the input resource
  // PROPERTIES (+ skill + station + risk) via the single craft-resolve layer.
  // An explicit opts.qualityMultiplier (e.g. a legacy minigame score) still
  // wins for back-compat; otherwise the resolved multiplier is used and a
  // conflicting-affinity backfire / potency-floor fizzle is honoured (soft —
  // mats consumed, a minor debuff, never a throw). Kill-switch CONCORD_CRAFT_RESOLVE=0.
  const explicitQM = typeof opts.qualityMultiplier === 'number'
    ? Math.max(0.5, Math.min(2.0, opts.qualityMultiplier))
    : null;
  let resolved = null;
  if (explicitQM == null && process.env.CONCORD_CRAFT_RESOLVE !== '0') {
    try {
      const craftSkill = _bestSkillLevel(playerSkills, 'crafting');
      const minPotency = Number(recipeData.spec?.minPotency)
        || Number(recipeData.minPotency) || 0;
      resolved = resolveCraft({
        inputs: _craftInputsFromRecipe(db, userId, resourceRequirements),
        recipe: { minPotency, name: recipeDtu.title },
        playerSkill: craftSkill,
        stationQuality: Number(opts.stationQuality) || 0,
        risk: Number(opts.risk) || 0,
        db,
      });
    } catch { resolved = null; }
  }

  // 7. All checks passed — wrap in a transaction
  let resultDtu = null;
  let itemAdded = false;
  let debuffApplied = null;

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
    // Quality multiplier: an explicit opts value (legacy minigame score) wins;
    // otherwise the resource-grounded craft-resolve result (Living Society P0).
    // Applied to all numeric stat fields so stronger mats / skill / station
    // produce measurably better gear.
    const qualityMultiplier = explicitQM ?? (resolved ? resolved.qualityMultiplier : 1.0);
    const baseStats = estimateStats(spec, playerSkills, worldRules);
    const scaledStats = {};
    for (const [k, v] of Object.entries(baseStats || {})) {
      scaledStats[k] = typeof v === 'number' ? Math.round(v * qualityMultiplier * 100) / 100 : v;
    }
    const outputData = {
      crafted_in_world: worldId,
      recipe_id: recipeId,
      stats: scaledStats,
      quality_multiplier: qualityMultiplier,
      enchantments: spec.enchantments || [],
      properties: spec.properties || {},
    };
    // Stamp the resolved resource provenance so downstream systems (UI, combat
    // affinity coupling, marketplace) can read what the craft actually became.
    if (resolved) {
      outputData.resource_affinity = resolved.outputAffinity;
      outputData.resource_potency = resolved.outputPotency;
      outputData.resource_stability = resolved.outputStability;
      if (resolved.failed) {
        outputData.craft_failed = true;
        outputData.craft_fail_reason = resolved.reason;
      }
    }

    const dtuId = crypto.randomUUID();
    const outputType = recipeData.output_type || spec.output_type || 'item';
    const dtuName = recipeDtu.title || spec.name || 'Crafted Item';

    db.prepare(`
      INSERT INTO dtus (id, creator_id, type, title, data, skill_level)
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

    // Soft-failure debuff (backfire / potency-floor fizzle). Mats are already
    // consumed above; the craft yields a weak item plus a short debuff —
    // never a hard lock. Guarded: user_active_effects may be absent on a
    // minimal build.
    if (resolved?.failed && resolved.debuff?.effect_id) {
      try {
        const d = resolved.debuff;
        const durS = Math.max(1, Math.floor((d.durationMs ?? 60000) / 1000));
        const expiresAt = Math.floor(Date.now() / 1000) + durS;
        db.prepare(`
          INSERT INTO user_active_effects
            (id, user_id, effect_id, kind, magnitude, source_dtu_id, expires_at)
          VALUES (?, ?, ?, 'debuff', ?, ?, ?)
        `).run(`eff_${crypto.randomUUID()}`, userId, String(d.effect_id),
          Number(d.magnitude) || 0.05, dtuId, expiresAt);
        debuffApplied = { effect_id: d.effect_id, magnitude: d.magnitude, expires_in_s: durS };
      } catch { /* user_active_effects absent — debuff is best-effort */ }
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

  const out = { ok: true, dtu: resultDtu, itemAdded };
  if (resolved) {
    out.qualityMultiplier = explicitQM ?? resolved.qualityMultiplier;
    out.resolved = {
      outputPotency: resolved.outputPotency,
      outputAffinity: resolved.outputAffinity,
      outputStability: resolved.outputStability,
      backfireChance: resolved.backfireChance,
      failed: !!resolved.failed,
      reason: resolved.reason,
    };
    if (resolved.failed) out.failed = true;
    if (debuffApplied) out.debuff = debuffApplied;
  }
  return out;
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
