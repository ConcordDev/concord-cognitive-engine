// server/lib/skills/skill-mastery.js
//
// T3.1 — per-skill mastery + per-skill VFX, server-authoritative.
//
// `player_skill_levels` (migration 064) already tracks a per-skill level + xp,
// and combat-frame-data quietly scaled startup/recovery by level. But mastery
// was never a first-class concept: there was no notion of *tiers*, no
// per-tier bonuses a player could feel cross, and no VFX that grew as a skill
// matured. A level-3 fireball and a level-95 fireball threw the exact same
// particle burst.
//
// This module makes mastery first-class and deterministic:
//   - MASTERY_TIERS: level thresholds → tier (novice…grandmaster) + bonuses.
//   - masteryForLevel(level): the tier + progress to the next tier.
//   - skillVfxDescriptor(...): per-skill VFX params (element palette + tier
//     scaling: particle count, scale, trail, glow, finisher flag) the client
//     renders verbatim, so a master's cast genuinely looks bigger.
//   - getSkillMastery / getAllSkillMastery: DB reads over player_skill_levels.
//
// All pure/deterministic (no RNG) so it's testable and a client can't inflate
// its own mastery.

/**
 * Mastery tiers. `minLevel` is inclusive. Bonuses are small, stacking-by-tier
 * multipliers the combat path can fold in: `frameSpeed` shaves startup/recovery
 * (mirrors combat-frame-data's level scaling but quantised to felt tiers),
 * `potency` is a damage/effect multiplier, `poiseBonus` adds to the caster's
 * own poise budget (a master is harder to stagger mid-cast).
 */
export const MASTERY_TIERS = Object.freeze([
  { tier: "novice",      tierIndex: 0, minLevel: 0,  frameSpeed: 1.00, potency: 1.00, poiseBonus: 0.00, finisher: false },
  { tier: "apprentice",  tierIndex: 1, minLevel: 10, frameSpeed: 0.97, potency: 1.05, poiseBonus: 0.05, finisher: false },
  { tier: "adept",       tierIndex: 2, minLevel: 25, frameSpeed: 0.93, potency: 1.12, poiseBonus: 0.10, finisher: false },
  { tier: "expert",      tierIndex: 3, minLevel: 45, frameSpeed: 0.88, potency: 1.20, poiseBonus: 0.18, finisher: true  },
  { tier: "master",      tierIndex: 4, minLevel: 70, frameSpeed: 0.82, potency: 1.30, poiseBonus: 0.28, finisher: true  },
  { tier: "grandmaster", tierIndex: 5, minLevel: 95, frameSpeed: 0.75, potency: 1.45, poiseBonus: 0.40, finisher: true  },
]);

/** Element → base VFX palette (hex colours + a named particle preset). */
export const ELEMENT_VFX = Object.freeze({
  fire:      { primary: "#ff6a2b", secondary: "#ffd24a", preset: "embers",   light: "#ff8a3d" },
  ice:       { primary: "#7fd4ff", secondary: "#dff4ff", preset: "shards",    light: "#bfeaff" },
  lightning: { primary: "#9b8cff", secondary: "#e8e2ff", preset: "arcs",      light: "#c4b8ff" },
  poison:    { primary: "#7bd16a", secondary: "#c9f5b0", preset: "miasma",    light: "#a6e88f" },
  bio:       { primary: "#46c98f", secondary: "#bff0d8", preset: "spores",    light: "#7fe0b6" },
  energy:    { primary: "#5ad6ff", secondary: "#e0fbff", preset: "plasma",    light: "#9be9ff" },
  physical:  { primary: "#d7d2c8", secondary: "#fff8e8", preset: "impact",    light: "#ece7da" },
  none:      { primary: "#cfcfcf", secondary: "#ffffff", preset: "impact",    light: "#e6e6e6" },
});

/** Clamp a level into the supported 0..120 range. */
function clampLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(120, Math.floor(n));
}

/**
 * Resolve the mastery tier for a level, plus progress toward the next tier.
 * `progressToNext` is 0..1 within the current tier band (1 at the cap tier).
 */
export function masteryForLevel(level) {
  const lvl = clampLevel(level);
  let cur = MASTERY_TIERS[0];
  for (const t of MASTERY_TIERS) {
    if (lvl >= t.minLevel) cur = t;
    else break;
  }
  const next = MASTERY_TIERS[cur.tierIndex + 1] || null;
  let progressToNext = 1;
  let levelsToNext = 0;
  if (next) {
    const span = next.minLevel - cur.minLevel;
    const into = lvl - cur.minLevel;
    progressToNext = span > 0 ? Math.max(0, Math.min(1, into / span)) : 1;
    levelsToNext = Math.max(0, next.minLevel - lvl);
  }
  return {
    level: lvl,
    tier: cur.tier,
    tierIndex: cur.tierIndex,
    nextTier: next ? next.tier : null,
    nextTierAtLevel: next ? next.minLevel : null,
    levelsToNext,
    progressToNext: Math.round(progressToNext * 1000) / 1000,
    bonuses: {
      frameSpeed: cur.frameSpeed,
      potency: cur.potency,
      poiseBonus: cur.poiseBonus,
      finisherUnlocked: cur.finisher,
    },
  };
}

/**
 * Per-skill VFX descriptor. Element drives the palette; mastery tier drives the
 * intensity (particle count, scale, trail length, glow, and whether a finisher
 * flourish unlocks). The client renders these verbatim — a grandmaster fireball
 * throws ~3× the particles of a novice one, with a brighter core and a trail.
 */
export function skillVfxDescriptor({ skillType = null, element = "none", kind = null, level = 0 } = {}) {
  const palette = ELEMENT_VFX[element] || ELEMENT_VFX.none;
  const m = masteryForLevel(level);
  const t = m.tierIndex; // 0..5

  const particleCount = Math.round(14 + t * 9);          // 14 → 59
  const scale = Math.round((1 + t * 0.16) * 100) / 100;  // 1.00 → 1.80
  const trailLength = Math.round(t * 0.12 * 100) / 100;  // 0 → 0.60
  const glow = Math.round((0.4 + t * 0.12) * 100) / 100; // 0.40 → 1.00
  const cameraKickPx = t >= 4 ? 6 : t >= 2 ? 3 : 0;      // expert+ kick

  return {
    skillType,
    kind,
    element,
    tier: m.tier,
    tierIndex: t,
    palette,
    particles: { count: particleCount, scale, trailLength },
    glow,
    cameraKickPx,
    finisherFlourish: m.bonuses.finisherUnlocked,
  };
}

function tableExists(db, name) {
  try {
    return !!db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(name);
  } catch {
    return false;
  }
}

/**
 * Read one skill's mastery for a user. `skillType` matches
 * `player_skill_levels.skill_type`. Aggregates across world-types (MAX level,
 * SUM xp) so a skill the player trained in several worlds reads as one mastery.
 * Returns level-0 novice mastery when the player has never used the skill.
 */
export function getSkillMastery(db, userId, skillType, opts = {}) {
  let level = 0, xp = 0;
  if (db && tableExists(db, "player_skill_levels")) {
    const row = db.prepare(`
      SELECT MAX(level) AS level, SUM(xp) AS xp, MAX(xp_to_next) AS xp_to_next
      FROM player_skill_levels WHERE user_id = ? AND skill_type = ?
    `).get(userId, skillType);
    level = row?.level || 0;
    xp = row?.xp || 0;
  }
  const mastery = masteryForLevel(level);
  const vfx = skillVfxDescriptor({
    skillType, element: opts.element || "none", kind: opts.kind || null, level,
  });
  return { skillType, xp, ...mastery, vfx };
}

/** All of a user's skills with mastery + VFX, highest level first. */
export function getAllSkillMastery(db, userId) {
  if (!db || !tableExists(db, "player_skill_levels")) return [];
  const rows = db.prepare(`
    SELECT skill_type, MAX(level) AS level, SUM(xp) AS xp
    FROM player_skill_levels WHERE user_id = ?
    GROUP BY skill_type ORDER BY level DESC, skill_type ASC
  `).all(userId);
  return rows.map((r) => {
    const mastery = masteryForLevel(r.level || 0);
    return {
      skillType: r.skill_type,
      xp: r.xp || 0,
      ...mastery,
      vfx: skillVfxDescriptor({ skillType: r.skill_type, level: r.level || 0 }),
    };
  });
}
