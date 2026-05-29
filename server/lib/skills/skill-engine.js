// server/lib/skills/skill-engine.js
// World-physics-aware skill resolution and progression.

import crypto from 'node:crypto';
import { awardCharacterLevel } from './character-level.js';
import { effectivenessMultiplier as crossWorldMul } from '../cross-world-effectiveness.js';
import { grantTalentPoints } from '../talents.js';
import { gainAscensionXp } from '../ascension.js';

// ── Skill → native world type mapping ─────────────────────────────────────────

export const SKILL_UNIVERSE_MAP = {
  magic:       ['fantasy'],
  enchanting:  ['fantasy'],
  summoning:   ['fantasy'],
  flight:      ['superpowered', 'fantasy'],
  power:       ['superpowered'],
  telepathy:   ['superpowered'],
  hacking:     ['urban_crime', 'military', 'standard'],
  technology:  ['urban_crime', 'military', 'standard'],
  stealth:     ['urban_crime', 'military', 'fantasy', 'superpowered', 'post_apocalyptic'],
  combat:      ['military', 'post_apocalyptic', 'fantasy', 'superpowered', 'urban_crime'],
  survival:    ['post_apocalyptic', 'military'],
  crafting:    ['standard', 'fantasy', 'post_apocalyptic', 'superpowered', 'urban_crime', 'military'],
  persuasion:  ['urban_crime', 'standard'],
  tactics:     ['military', 'superpowered'],
  alchemy:     ['fantasy', 'post_apocalyptic'],
  engineering: ['standard', 'military', 'urban_crime'],
};

// ── Core effectiveness computation ────────────────────────────────────────────

/**
 * Compute how effective a skill is in a world given the world's rule modulators.
 *
 * Layers two cross-world systems (applied multiplicatively):
 *   1. `rule_modulators` from the `worlds` DB row (skill_resistance + skill_effectiveness_rules)
 *   2. `skill_affinity` from `content/world/<id>/meta.json` (consulted via
 *      cross-world-effectiveness.js with the level-floor formula:
 *      `floor = 0.10 + 0.40 × min(1, level/maxLevel)`, so a master retains
 *      partial potency anywhere while a novice does not).
 *
 * Pass `opts.worldId` to activate layer 2. Without it, layer 2 is skipped
 * (backward compatible with every existing callsite).
 *
 * @param {string} skillType
 * @param {number} nativeLevel  - Player's level in this skill
 * @param {object|string} worldRuleModulators - Parsed or raw JSON rule_modulators
 * @param {object} [opts]
 * @param {string} [opts.worldId]  - Current world id (activates skill_affinity layer)
 * @param {number} [opts.maxLevel=100]
 * @returns {{ effective: boolean, effectiveLevel: number, multiplier: number,
 *   crossWorldMultiplier?: number, reason?: string }}
 */
export function computeSkillEffectiveness(skillType, nativeLevel, worldRuleModulators, opts = {}) {
  const rules = typeof worldRuleModulators === 'string'
    ? _parseJSON(worldRuleModulators, {})
    : (worldRuleModulators || {});

  // Layer 2: per-meta.json skill_affinity (with level floor). Skipped if
  // no worldId is provided — preserves existing callsite shape.
  const xwMul = opts?.worldId
    ? crossWorldMul({
        domain: skillType,
        worldId: opts.worldId,
        level: nativeLevel,
        maxLevel: opts.maxLevel || 100,
      })
    : 1.0;

  const resistance = rules.skill_resistance || {};
  const effectivenessRules = rules.skill_effectiveness_rules || {};

  // ── Resistance check ────────────────────────────────────────────────────────
  const resistConfig = resistance[skillType];
  if (resistConfig) {
    const { threshold = 0, scaling = 1.0 } = resistConfig;
    if (nativeLevel < threshold) {
      return {
        effective: false,
        effectiveLevel: 0,
        multiplier: 0,
        reason: `Skill level ${nativeLevel} is below world resistance threshold ${threshold} for '${skillType}'`,
      };
    }
    // Apply scaling above threshold
    const above = nativeLevel - threshold;
    const scaledLevel = threshold + above * scaling;

    // ── Multiplier check ──────────────────────────────────────────────────────
    const ruleEntry = effectivenessRules[skillType] || effectivenessRules['default'] || { multiplier: 1.0 };
    const multiplier = ruleEntry.multiplier ?? 1.0;

    if (multiplier === 0.0) {
      return {
        effective: false,
        effectiveLevel: 0,
        multiplier: 0,
        reason: `Skill '${skillType}' has zero effectiveness in this world`,
      };
    }

    const combinedMul = multiplier * xwMul;
    const effectiveLevel = scaledLevel * combinedMul;
    return {
      effective: true,
      effectiveLevel: Math.round(effectiveLevel * 10) / 10,
      multiplier: Math.round(combinedMul * 1000) / 1000,
      crossWorldMultiplier: opts?.worldId ? Math.round(xwMul * 1000) / 1000 : undefined,
    };
  }

  // No resistance config — check effectiveness rules only
  const ruleEntry = effectivenessRules[skillType] || effectivenessRules['default'] || { multiplier: 1.0 };
  const multiplier = ruleEntry.multiplier ?? 1.0;

  if (multiplier === 0.0) {
    return {
      effective: false,
      effectiveLevel: 0,
      multiplier: 0,
      reason: `Skill '${skillType}' has zero effectiveness in this world`,
    };
  }

  const combinedMul = multiplier * xwMul;
  const effectiveLevel = nativeLevel * combinedMul;
  return {
    effective: true,
    effectiveLevel: Math.round(effectiveLevel * 10) / 10,
    multiplier: Math.round(combinedMul * 1000) / 1000,
    crossWorldMultiplier: opts?.worldId ? Math.round(xwMul * 1000) / 1000 : undefined,
  };
}

// ── World skill creation check ─────────────────────────────────────────────────

/**
 * Check whether a skill type can be created/learned in the given world type.
 *
 * @param {string} skillType
 * @param {string} worldType
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canCreateSkillInWorld(skillType, worldType) {
  const nativeWorlds = SKILL_UNIVERSE_MAP[skillType];
  if (!nativeWorlds) {
    // Unknown skill types are allowed everywhere
    return { ok: true };
  }
  if (!nativeWorlds.includes(worldType)) {
    return {
      ok: false,
      reason: `Skill '${skillType}' is native to [${nativeWorlds.join(', ')}] — cannot be created in '${worldType}'`,
    };
  }
  return { ok: true };
}

// ── Database helpers ──────────────────────────────────────────────────────────

/**
 * Return all player_skill_levels rows for this user.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @returns {object[]}
 */
export function getPlayerSkills(db, userId) {
  return db.prepare(
    'SELECT * FROM player_skill_levels WHERE user_id = ? ORDER BY skill_type, level DESC'
  ).all(userId);
}

/**
 * Return the highest level the player has for a skill across all world types.
 * Portability: best level wins; effectiveness is then applied per-world.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {string} skillType
 * @returns {number}
 */
export function getPlayerSkillLevel(db, userId, skillType) {
  const row = db.prepare(
    'SELECT MAX(level) AS max_level FROM player_skill_levels WHERE user_id = ? AND skill_type = ?'
  ).get(userId, skillType);
  return row?.max_level ?? 0;
}

/**
 * Add XP to a player's skill, leveling up if the threshold is reached.
 * XP to next level: 100 × current level (level 1→2 costs 100 XP, 10→11 costs 1000 XP).
 * Max level is 100.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {string} skillType
 * @param {string} worldType
 * @param {number} xpGain
 * @returns {{ leveled: boolean, newLevel: number, newXp: number }}
 */
export function gainSkillXP(db, userId, skillType, worldType, xpGain, opts = {}) {
  const MAX_LEVEL = 100;

  // Upsert the row
  const existingId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level, xp, xp_to_next, last_used_at)
    VALUES (?, ?, ?, ?, 1, 0, 100, unixepoch())
    ON CONFLICT(user_id, skill_type, native_world_type) DO UPDATE SET last_used_at = unixepoch()
  `).run(existingId, userId, skillType, worldType);

  // Re-read current state
  const row = db.prepare(
    'SELECT * FROM player_skill_levels WHERE user_id = ? AND skill_type = ? AND native_world_type = ?'
  ).get(userId, skillType, worldType);

  if (!row) return { leveled: false, newLevel: 0, newXp: 0 };

  let { level, xp, xp_to_next } = row;

  if (level >= MAX_LEVEL) {
    // D30 — at the skill cap, XP was previously discarded. Route it into the
    // account-wide ascension/paragon endgame track instead (the day-30 sink).
    let ascension = null;
    try { ascension = gainAscensionXp(db, userId, xpGain); } catch { /* ascension table optional */ }
    return { leveled: false, newLevel: level, newXp: xp, atCap: true, ascension };
  }

  xp += xpGain;
  let leveled = false;
  let levelsGained = 0;

  while (xp >= xp_to_next && level < MAX_LEVEL) {
    xp -= xp_to_next;
    level += 1;
    xp_to_next = 100 * level; // next threshold scales with level — stacks matter
    leveled = true;
    levelsGained++;
  }

  db.prepare(`
    UPDATE player_skill_levels
    SET level = ?, xp = ?, xp_to_next = ?, last_used_at = unixepoch()
    WHERE user_id = ? AND skill_type = ? AND native_world_type = ?
  `).run(level, xp, xp_to_next, userId, skillType, worldType);

  // Award character levels for every skill level gained — upgrade points follow
  let characterLevelResult = null;
  if (leveled && levelsGained > 0 && opts.worldId) {
    try {
      for (let i = 0; i < levelsGained; i++) {
        characterLevelResult = awardCharacterLevel(db, userId, opts.worldId);
      }
    } catch { /* non-fatal */ }
  }

  // F2.3 — earn 1 talent point per level gained (the live level-up gain site).
  // Best-effort: the talents substrate is optional on minimal builds.
  if (leveled && levelsGained > 0) {
    try {
      grantTalentPoints(db, userId, levelsGained);
    } catch { /* talents table optional */ }
  }

  return { leveled, newLevel: level, newXp: xp, levelsGained, characterLevelResult };
}

/**
 * Seed starter skills (level 1) for combat and crafting native to the given world type.
 * Skips skill types that are not native to the world type.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {string} worldType
 */
export function initStarterSkills(db, userId, worldType) {
  const STARTER_SKILLS = ['combat', 'crafting'];

  for (const skillType of STARTER_SKILLS) {
    const nativeWorlds = SKILL_UNIVERSE_MAP[skillType];
    if (nativeWorlds && !nativeWorlds.includes(worldType)) continue;

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level, xp, xp_to_next)
      VALUES (?, ?, ?, ?, 1, 0, 100)
      ON CONFLICT(user_id, skill_type, native_world_type) DO NOTHING
    `).run(id, userId, skillType, worldType);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _parseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
