// server/lib/crafting/recipe-validator.js
// Validates user-designed recipe specs against world physics and player skills.

import { computeSkillEffectiveness } from '../skills/skill-engine.js';

// ── Base resource costs per item category ─────────────────────────────────────

export const ITEM_RESOURCE_COSTS = {
  sword:         [{ resource_id: 'iron-ore', quantity: 5 }, { resource_id: 'wood', quantity: 2 }],
  bow:           [{ resource_id: 'wood', quantity: 6 }, { resource_id: 'herbs', quantity: 1 }],
  staff:         [{ resource_id: 'enchanted-wood', quantity: 4 }, { resource_id: 'mana-crystal', quantity: 1 }],
  shield:        [{ resource_id: 'iron-ore', quantity: 4 }, { resource_id: 'wood', quantity: 3 }],
  armor:         [{ resource_id: 'iron-ore', quantity: 8 }, { resource_id: 'coal', quantity: 2 }],
  potion:        [{ resource_id: 'herbs', quantity: 3 }],
  spell:         [{ resource_id: 'mana-crystal', quantity: 1 }],
  ability:       [],  // no resources — pure skill expression
  building_plan: [{ resource_id: 'stone', quantity: 5 }, { resource_id: 'wood', quantity: 5 }],
  gadget:        [{ resource_id: 'scrap-metal', quantity: 4 }, { resource_id: 'fuel-canister', quantity: 1 }],
  explosive:     [{ resource_id: 'coal', quantity: 3 }, { resource_id: 'fuel-canister', quantity: 2 }],
};

// ── Minimum skill levels to create each item type ─────────────────────────────

export const SKILL_REQUIREMENTS_BY_TYPE = {
  sword:    [{ skill_type: 'crafting', level: 10 }],
  bow:      [{ skill_type: 'crafting', level: 8 }],
  staff:    [{ skill_type: 'crafting', level: 15 }, { skill_type: 'magic', level: 20 }],
  spell:    [{ skill_type: 'magic', level: 5 }],
  ability:  [{ skill_type: 'crafting', level: 1 }],
  potion:   [{ skill_type: 'alchemy', level: 5 }],
  gadget:   [{ skill_type: 'engineering', level: 10 }],
  explosive:[{ skill_type: 'engineering', level: 5 }],
  armor:    [{ skill_type: 'crafting', level: 12 }],
};

// ── Enchantment resource mapping ──────────────────────────────────────────────
// Maps enchantment names to the resource they consume and skill required.

const ENCHANTMENT_RESOURCES = {
  fire:       { resource_id: 'fire-essence',    quantity: 1, skill_type: 'enchanting', level: 10 },
  ice:        { resource_id: 'frost-crystal',   quantity: 1, skill_type: 'enchanting', level: 10 },
  lightning:  { resource_id: 'storm-shard',     quantity: 1, skill_type: 'enchanting', level: 12 },
  poison:     { resource_id: 'venom-extract',   quantity: 1, skill_type: 'alchemy',    level: 8  },
  healing:    { resource_id: 'herbs',           quantity: 2, skill_type: 'alchemy',    level: 5  },
  speed:      { resource_id: 'wind-crystal',   quantity: 1, skill_type: 'enchanting', level: 8  },
  strength:   { resource_id: 'mana-crystal',   quantity: 1, skill_type: 'enchanting', level: 15 },
  stealth:    { resource_id: 'shadow-dust',    quantity: 1, skill_type: 'enchanting', level: 12 },
  default:    { resource_id: 'mana-crystal',   quantity: 1, skill_type: 'enchanting', level: 5  },
};

// ── Weapon tier thresholds ─────────────────────────────────────────────────────
const WEAPON_TIERS = { sword: 2, staff: 3, bow: 1, gadget: 2, explosive: 1 };

// ── validateDesign ────────────────────────────────────────────────────────────

/**
 * Validate a user-designed recipe spec against world physics and player skills.
 *
 * @param {object} spec - { name, output_type, output_subtype, enchantments, properties }
 * @param {object[]} playerSkills - Rows from player_skill_levels
 * @param {object|string} worldRuleModulators
 * @param {string} worldType
 * @returns {{ valid: boolean, errors: string[], warnings: string[], resource_requirements: object[], skill_requirements: object[], estimated_stats: object }}
 */
export function validateDesign(spec, playerSkills, worldRuleModulators, worldType) {
  const errors = [];
  const warnings = [];

  const subtype = spec.output_subtype || spec.output_type;
  const enchantments = Array.isArray(spec.enchantments) ? spec.enchantments : [];

  // Build a lookup map for player skill levels
  const playerSkillMap = _buildSkillMap(playerSkills);

  // ── Skill requirements ────────────────────────────────────────────────────
  const baseSkillReqs = (SKILL_REQUIREMENTS_BY_TYPE[subtype] || []).map(r => ({ ...r }));

  // Add enchantment skill requirements
  const enchantmentSkillReqs = [];
  for (const enc of enchantments) {
    const encConfig = ENCHANTMENT_RESOURCES[enc] || ENCHANTMENT_RESOURCES['default'];
    enchantmentSkillReqs.push({ skill_type: encConfig.skill_type, level: encConfig.level });
  }

  const allSkillReqs = _mergeSkillRequirements([...baseSkillReqs, ...enchantmentSkillReqs]);

  // Validate each skill requirement against world physics
  for (const req of allSkillReqs) {
    const nativeLevel = playerSkillMap[req.skill_type] ?? 0;
    const effectiveness = computeSkillEffectiveness(req.skill_type, nativeLevel, worldRuleModulators);

    if (!effectiveness.effective) {
      errors.push(
        effectiveness.reason ||
        `Skill '${req.skill_type}' is not effective in this world`
      );
      continue;
    }

    if (effectiveness.effectiveLevel < req.level) {
      errors.push(
        `Skill '${req.skill_type}' requires effective level ${req.level}, but you have ${effectiveness.effectiveLevel.toFixed(1)} (native: ${nativeLevel}, world multiplier: ×${effectiveness.multiplier})`
      );
    }
  }

  // ── Resource requirements ─────────────────────────────────────────────────
  const baseResources = (ITEM_RESOURCE_COSTS[subtype] || []).map(r => ({ ...r }));

  const enchantmentResources = [];
  for (const enc of enchantments) {
    const encConfig = ENCHANTMENT_RESOURCES[enc] || ENCHANTMENT_RESOURCES['default'];
    enchantmentResources.push({ resource_id: encConfig.resource_id, quantity: encConfig.quantity });
  }

  const resource_requirements = _mergeResources([...baseResources, ...enchantmentResources]);

  // ── Warnings ──────────────────────────────────────────────────────────────
  if (!spec.name || spec.name.trim().length === 0) {
    warnings.push('Recipe has no name — a default will be used');
  }
  if (enchantments.length > 3) {
    warnings.push(`${enchantments.length} enchantments is unusual — performance may be reduced`);
  }
  if (!ITEM_RESOURCE_COSTS[subtype] && subtype !== 'ability') {
    warnings.push(`Unknown item subtype '${subtype}' — using empty resource list`);
  }

  const skill_requirements = allSkillReqs;
  const estimated_stats = estimateStats(spec, playerSkills, worldRuleModulators);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    resource_requirements,
    skill_requirements,
    estimated_stats,
  };
}

// ── estimateStats ─────────────────────────────────────────────────────────────

/**
 * Estimate crafted item stats from player skills and spec.
 *
 * @param {object} spec
 * @param {object[]} playerSkills
 * @param {object|string} worldRuleModulators
 * @returns {object}
 */
export function estimateStats(spec, playerSkills, worldRuleModulators) {
  const subtype = spec.output_subtype || spec.output_type;
  const enchantments = Array.isArray(spec.enchantments) ? spec.enchantments : [];
  const playerSkillMap = _buildSkillMap(playerSkills);

  const craftingLevel = playerSkillMap['crafting'] ?? 0;
  const enchantingLevel = playerSkillMap['enchanting'] ?? 0;
  const weaponTier = WEAPON_TIERS[subtype] ?? 1;

  const stats = {};

  // Durability applies to all physical items
  stats.durability = 100 + craftingLevel * 2;

  // Damage for weapons
  if (['sword', 'bow', 'staff', 'gadget', 'explosive'].includes(subtype)) {
    const enchantingEff = computeSkillEffectiveness('enchanting', enchantingLevel, worldRuleModulators);
    const enchantmentPower = enchantingEff.effective
      ? enchantingEff.effectiveLevel * 0.1 * enchantments.length
      : 0;

    stats.base_damage = 5 + craftingLevel * 0.5 + weaponTier * 3;
    stats.enchantment_power = Math.round(enchantmentPower * 10) / 10;
    stats.speed = subtype === 'bow' ? 1.2 : subtype === 'explosive' ? 0.6 : 1.0;
  }

  // Defense for armor/shield
  if (['armor', 'shield'].includes(subtype)) {
    stats.defense = 5 + craftingLevel * 0.4 + weaponTier * 2;
  }

  // Healing/effect power for potions/spells
  if (['potion', 'spell'].includes(subtype)) {
    const magicLevel = playerSkillMap['magic'] ?? 0;
    const magicEff = computeSkillEffectiveness('magic', magicLevel, worldRuleModulators);
    stats.effect_power = magicEff.effective ? magicEff.effectiveLevel * 0.5 + craftingLevel * 0.2 : craftingLevel * 0.2;
  }

  // Round all numeric stats
  for (const key of Object.keys(stats)) {
    if (typeof stats[key] === 'number') {
      stats[key] = Math.round(stats[key] * 10) / 10;
    }
  }

  return stats;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _buildSkillMap(playerSkills) {
  const map = {};
  for (const skill of (playerSkills || [])) {
    const cur = map[skill.skill_type] ?? 0;
    if (skill.level > cur) map[skill.skill_type] = skill.level;
  }
  return map;
}

function _mergeResources(resources) {
  const merged = {};
  for (const r of resources) {
    if (!merged[r.resource_id]) {
      merged[r.resource_id] = { resource_id: r.resource_id, quantity: 0 };
    }
    merged[r.resource_id].quantity += r.quantity;
  }
  return Object.values(merged);
}

function _mergeSkillRequirements(reqs) {
  const merged = {};
  for (const r of reqs) {
    if (!merged[r.skill_type] || r.level > merged[r.skill_type].level) {
      merged[r.skill_type] = { skill_type: r.skill_type, level: r.level };
    }
  }
  return Object.values(merged);
}
