// server/lib/skill-atrophy.js
import logger from "../logger.js";
// Skills not used in 14+ days decay at 0.01 levels/day.
// Capped at level 1. Legendary+ skills (level >= 500) are immune.
// last_used_at column added by migration 046.

const DECAY_RATE        = 0.01;   // levels per day
const GRACE_DAYS        = 14;     // no decay in first 14 days
const IMMUNITY_LEVEL    = 500;    // Legendary — immune to atrophy
const WARN_DAYS         = 7;      // amber warning at 7 days unused
const CYCLE_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

export function getAtrophyRisk(skill) {
  if (!skill.last_used_at) return { daysUnused: null, projectedLoss: 0, immune: false };
  const daysUnused = (Date.now() - skill.last_used_at) / 86_400_000;
  const immune = (skill.skill_level || 1) >= IMMUNITY_LEVEL;
  const projectedLoss = immune || daysUnused < GRACE_DAYS
    ? 0
    : Math.min(skill.skill_level - 1, (daysUnused - GRACE_DAYS) * DECAY_RATE);
  return { daysUnused: Math.floor(daysUnused), projectedLoss: +projectedLoss.toFixed(3), immune };
}

export async function runAtrophyCycle(db) {
  const now = Date.now();
  const graceMs = GRACE_DAYS * 86_400_000;
  const cutoff = now - graceMs;

  const skills = db.prepare(`
    SELECT id, skill_level, last_used_at FROM dtus
    WHERE type = 'skill'
      AND skill_level > 1
      AND skill_level < ?
      AND last_used_at IS NOT NULL
      AND last_used_at < ?
  `).all(IMMUNITY_LEVEL, cutoff);

  let decayed = 0;
  for (const skill of skills) {
    const daysOverGrace = ((now - skill.last_used_at) / 86_400_000) - GRACE_DAYS;
    const loss = Math.min(skill.skill_level - 1, daysOverGrace * DECAY_RATE);
    if (loss <= 0) continue;

    const newLevel = Math.max(1, skill.skill_level - loss);
    db.prepare(`UPDATE dtus SET skill_level = ? WHERE id = ?`).run(newLevel, skill.id);
    decayed++;
  }
  return { processed: skills.length, decayed };
}

export function startAtrophyCycle(db) {
  runAtrophyCycle(db).catch(err => logger?.debug?.('[skill-atrophy] background op failed', { err: err?.message }));
  return setInterval(() => runAtrophyCycle(db).catch(err => logger?.debug?.('[skill-atrophy] background op failed', { err: err?.message })), CYCLE_INTERVAL_MS);
}
