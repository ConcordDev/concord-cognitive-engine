// server/lib/embodied/pain.js
//
// Layer 8: pain-signal helpers for the repair-cycle heartbeat.
//
// Pain is a per-player somatic ledger distinct from damage_events. Each
// row records *what the player felt* — region, intensity (0..1), source
// class. The repair-cycle heartbeat consumes pending rows in batches,
// awards endurance / strength / agility / vitality / focus XP based on
// the regional distribution, grants a short-lived `damage_resist` buff
// (the "what doesn't kill you makes you tougher" mechanic), and marks
// rows processed.
//
// Why a separate table: damage_events is symmetric (attacker + defender,
// NPCs and players both). pain_signals is asymmetric — only players
// generate it; NPCs adapt via archetype levels. Region taxonomy also
// only makes sense for player progression.
//
// Region → skill mapping:
//   head     → focus       (concentration / will under attack)
//   torso    → vitality    (HP cap / regen)
//   arms     → strength    (damage with melee + carry capacity)
//   legs     → agility     (move speed + dodge)
//   systemic → endurance   (stamina pool + regen)

import crypto from "node:crypto";

export const REGIONS = Object.freeze(["head", "torso", "arms", "legs", "systemic"]);
export const REGION_SKILL = Object.freeze({
  head:     "focus",
  torso:    "vitality",
  arms:     "strength",
  legs:     "agility",
  systemic: "endurance",
});

const SOURCES = new Set(["combat", "fall", "environment", "fatigue", "spell", "poison"]);

/**
 * Record an embodied pain signal. Caller is the route or heartbeat that
 * detected the harm (combat hit, fall damage, environmental exposure).
 *
 * Intensity is 0..1 — caller is responsible for normalising. For combat:
 *   intensity = clamp(finalDamage / 100, 0.05, 1)
 * For environmental fire ticks at half a second:
 *   intensity = clamp(tickDamage / 50, 0.02, 0.5)
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {object} opts
 * @returns {{ id: string } | null}
 */
export function recordPain(db, userId, opts = {}) {
  if (!db || !userId) return null;
  const { worldId = null, region, intensity, source, sourceId = null, element = null } = opts;
  if (!REGIONS.includes(region)) return null;
  if (!SOURCES.has(source)) return null;
  const i = Number(intensity);
  if (!Number.isFinite(i) || i < 0) return null;
  const clamped = Math.max(0, Math.min(1, i));

  const id = `pain_${crypto.randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO pain_signals
        (id, user_id, world_id, region, intensity, source, source_id, element)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, worldId, region, clamped, source, sourceId, element);
    return { id };
  } catch {
    return null;
  }
}

/**
 * Map a damage element to the body region that absorbs it. Used by the
 * combat-side wire to convert a damage_event into a pain_signal without
 * requiring callers to think about anatomy.
 */
export function regionForElement(element) {
  switch (element) {
    case "fire":      return "systemic";
    case "ice":       return "torso";
    case "water":     return "systemic";
    case "lightning": return "systemic";
    case "bio":       return "torso";
    case "poison":    return "systemic";
    case "energy":    return "head";
    case "physical":  return "torso";
    default:          return "torso";
  }
}

/**
 * Read pending pain budget for a user. Heartbeat reads this to decide
 * whether to run a repair cycle. Returns rows grouped by region with
 * total intensity per region.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 */
export function getPainBudget(db, userId) {
  if (!db || !userId) return { total: 0, byRegion: {}, count: 0 };
  let rows;
  try {
    rows = db.prepare(`
      SELECT region, SUM(intensity) AS total, COUNT(*) AS n
        FROM pain_signals
       WHERE user_id = ? AND processed_at IS NULL
       GROUP BY region
    `).all(userId);
  } catch {
    return { total: 0, byRegion: {}, count: 0 };
  }
  const byRegion = {};
  let total = 0;
  let count = 0;
  for (const r of rows) {
    byRegion[r.region] = Number(r.total ?? 0);
    total += Number(r.total ?? 0);
    count += Number(r.n ?? 0);
  }
  return { total, byRegion, count };
}

/**
 * Consume the user's pending pain budget. Marks rows processed and
 * returns the same shape as getPainBudget for the consumer to act on.
 * Idempotent: a second call returns zero.
 *
 * Caller is responsible for awarding XP / granting buffs based on the
 * returned budget — this function only handles the ledger transition.
 */
export function consumePainBudget(db, userId) {
  if (!db || !userId) return { total: 0, byRegion: {}, count: 0 };
  const tx = db.transaction(() => {
    const budget = getPainBudget(db, userId);
    if (budget.count === 0) return budget;
    db.prepare(`
      UPDATE pain_signals
         SET processed_at = unixepoch()
       WHERE user_id = ? AND processed_at IS NULL
    `).run(userId);
    return budget;
  });
  try {
    return tx();
  } catch {
    return { total: 0, byRegion: {}, count: 0 };
  }
}

/**
 * GC sweep — hard-delete processed rows older than 30 days. The repair
 * cycle calls this opportunistically; tests can call it directly.
 */
export function decayProcessedPain(db, olderThanDays = 30) {
  if (!db) return 0;
  const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 86400;
  try {
    const r = db.prepare(`
      DELETE FROM pain_signals
       WHERE processed_at IS NOT NULL AND processed_at < ?
    `).run(cutoff);
    return r.changes;
  } catch {
    return 0;
  }
}
