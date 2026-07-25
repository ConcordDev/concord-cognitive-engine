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
// Living Society Phase 8 — mastery-as-passport. A hostile world damps off-
// affinity skills, but a high MASTERY tier overcomes that damping: a grandmaster
// spell still fires in a no-magic world (reduced, not nullified). The floor is a
// fraction of native level by mastery tier index (0..5); 0 for novice/apprentice/
// adept (no passport), rising for expert/master/grandmaster. Pass
// opts.masteryTierIndex (from skill-mastery.js#masteryForLevel) to enable it.
const MASTERY_PASSPORT_FLOOR = Object.freeze([0, 0, 0, 0.15, 0.25, 0.35]);
function _masteryPassport(nativeLevel, opts) {
  const idx = Number(opts?.masteryTierIndex);
  if (!Number.isFinite(idx) || idx < 3) return 0;
  return Math.round(nativeLevel * MASTERY_PASSPORT_FLOOR[Math.min(5, idx)] * 10) / 10;
}

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
      const passport = _masteryPassport(nativeLevel, opts);
      if (passport > 0) {
        return { effective: true, effectiveLevel: passport, multiplier: Math.round((passport / Math.max(1, nativeLevel)) * 1000) / 1000, masteryPassport: true, reason: `mastery passport: below threshold but a high-mastery cast fires reduced` };
      }
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
      const passport = _masteryPassport(scaledLevel, opts);
      if (passport > 0) {
        return { effective: true, effectiveLevel: passport, multiplier: Math.round((passport / Math.max(1, scaledLevel)) * 1000) / 1000, masteryPassport: true, reason: `mastery passport: zero-effectiveness world, but a high-mastery cast fires reduced` };
      }
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
    const passport = _masteryPassport(nativeLevel, opts);
    if (passport > 0) {
      return { effective: true, effectiveLevel: passport, multiplier: Math.round((passport / Math.max(1, nativeLevel)) * 1000) / 1000, masteryPassport: true, reason: `mastery passport: a no-affinity world damps but a grandmaster still fires reduced` };
    }
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

  // DEAD-SUBSCRIPTION Class B — `system:skill-acquired`. SystemFeed.tsx:78
  // (components/world/) renders a POWER ACQUIRED System window off this event
  // and reads `name` (falling back to `skill`), but nothing ever emitted it.
  // The honest moment is right here: the FIRST time this user gets any
  // player_skill_levels row for this skill_type — i.e. they did not have the
  // skill before this grant and do now. Checked across every
  // native_world_type on purpose: a second row for a skill the player already
  // has is a world variant, not a new power. Read before the upsert below,
  // because the upsert itself creates the row.
  let firstAcquisition = false;
  try {
    firstAcquisition = !db.prepare(
      'SELECT 1 FROM player_skill_levels WHERE user_id = ? AND skill_type = ? LIMIT 1'
    ).get(userId, skillType);
  } catch { firstAcquisition = false; }

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

  // The acquisition beat fires once the row genuinely exists (see the
  // firstAcquisition read above). Scoped to the acquiring user's own
  // `user:<id>` room — a personal progression beat, never a broadcast.
  if (firstAcquisition) {
    try {
      const emitFn = globalThis._concordRealtimeEmit || globalThis.realtimeEmit;
      if (typeof emitFn === "function") {
        emitFn("system:skill-acquired", {
          userId,
          name: skillType,   // SystemFeed reads `name` first…
          skill: skillType,  // …then falls back to `skill`
          level: row.level,
          worldType,
        }, { userId });
      }
    } catch { /* realtime is best-effort — never break the XP grant */ }
  }

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

  // DET-C batch 3 — CharacterSheetPanel.tsx (concord-frontend/components/
  // world-lens/) reads its skillSummary + bars from this exact table
  // (player_skill_levels) via getCharacterProgress, and has listened for a
  // 'concordia:character-updated' window event since it was written so it
  // can refresh live while open — but nothing server-side ever emitted it.
  // The two prior candidate wires (the 'level:up' mastery-track event and
  // 'skill:xp-awarded' from skill-progression.js) are BOTH a different,
  // unrelated progression system (mastery rank / Sovereign Refusal Archive
  // dtus.skill_level) — dispatching this panel's refresh off either would
  // have refreshed on the wrong trigger. This is the real one: emit
  // 'character:updated' scoped to the leveling user whenever a skill level
  // bump actually lands in player_skill_levels (bars may or may not also
  // move, depending on opts.worldId below, but skillSummary always did).
  if (leveled) {
    try {
      const emitFn = globalThis._concordRealtimeEmit;
      if (typeof emitFn === "function") {
        emitFn("character:updated", { userId, skillType, newLevel: level }, { userId });
      }
    } catch { /* realtime is best-effort */ }

    // DEAD-SUBSCRIPTION Class B — `system:level-up`. SystemFeed.tsx:77 renders
    // the LEVEL UP System window off this event and reads `detail` (falling
    // back to `skill`). This is the real level-up site for System A
    // (player_skill_levels); the separate `skill:xp-awarded` beat SystemFeed
    // also listens for belongs to the OTHER progression system
    // (dtus.skill_level via skill-progression.js), so the two don't double-fire
    // for the same level-up. Own try/catch so a realtime hiccup on the
    // character:updated emit above can't swallow this one (or vice versa).
    try {
      const emitFn = globalThis._concordRealtimeEmit || globalThis.realtimeEmit;
      if (typeof emitFn === "function") {
        emitFn("system:level-up", {
          userId,
          skill: skillType,
          level,
          detail: `${skillType} reached Lv ${level}`,
        }, { userId });
      }
    } catch { /* realtime is best-effort — never break the XP grant */ }
  }

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
