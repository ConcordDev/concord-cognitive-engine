// server/lib/difficulty.js
//
// Phase BD2 — difficulty ladder.
//
// Per-encounter prerequisite chain:
//   finder  — always unlocked
//   normal  — requires finder clear of THIS encounter
//   heroic  — requires normal clear of THIS encounter
//   mythic  — requires heroic clear of THIS encounter

import logger from "../logger.js";

const TIER_ORDER = ["finder", "normal", "heroic", "mythic"];
const PREREQ = {
  finder: null,
  normal: "finder",
  heroic: "normal",
  mythic: "heroic",
};

export function getModifier(db, tier) {
  if (!db) return null;
  try {
    return db.prepare(`SELECT * FROM difficulty_modifiers WHERE tier = ?`).get(tier) || null;
  } catch { return null; }
}

/**
 * Apply tier scaling to an encounter object — returns a NEW object
 * with damage/health/loot scaled. Pure.
 */
export function applyDifficulty(encounter, modifier) {
  if (!encounter || !modifier) return encounter;
  return {
    ...encounter,
    damage: (Number(encounter.damage) || 0) * modifier.damage_mult,
    health: (Number(encounter.health) || 0) * modifier.health_mult,
    loot:   (Number(encounter.loot) || 0)   * modifier.loot_mult,
    tier:   modifier.tier,
  };
}

/**
 * Has the user unlocked `tier` for this encounter? Walks the
 * prerequisite chain.
 */
export function tierUnlockedFor(db, userId, encounterId, tier) {
  if (!TIER_ORDER.includes(tier)) return false;
  const prereq = PREREQ[tier];
  if (!prereq) return true; // finder is always unlocked.
  if (!db || !userId || !encounterId) return false;
  try {
    const row = db.prepare(`
      SELECT 1 FROM difficulty_clears
      WHERE user_id = ? AND encounter_id = ? AND tier = ?
    `).get(userId, encounterId, prereq);
    return !!row;
  } catch { return false; }
}

/**
 * Record that a user cleared an encounter at a tier. Idempotent on
 * (user, encounter, tier) PK.
 */
export function recordClear(db, userId, encounterId, tier) {
  if (!db || !userId || !encounterId) return { ok: false, error: "missing_inputs" };
  if (!TIER_ORDER.includes(tier)) return { ok: false, error: "invalid_tier" };
  try {
    db.prepare(`
      INSERT INTO difficulty_clears (user_id, encounter_id, tier)
      VALUES (?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(userId, encounterId, tier);
    logger.info?.("difficulty", "clear", { userId, encounterId, tier });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export { TIER_ORDER, PREREQ };
