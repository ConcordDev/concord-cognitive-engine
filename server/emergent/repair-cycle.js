// server/emergent/repair-cycle.js
//
// Layer 8 heartbeat: the repair brain consumes pending pain signals,
// grants endurance / strength / agility / vitality / focus XP based on
// the regional distribution, and grants a short-lived `damage_resist`
// buff (the "what doesn't kill you makes you tougher" mechanic).
//
// Frequency: every 20 ticks (~5 minutes). The cadence balances
// "frequent enough that taking a beating in combat shows up as XP
// before you log off" against "infrequent enough that we batch many
// small hits into one meaningful adaptation moment."
//
// XP MATH:
//   per region: xp = round(totalIntensity * REGION_XP_PER_PAIN_UNIT)
//   default REGION_XP_PER_PAIN_UNIT = 35
//   This means a player who absorbs ~5 hits at 0.4 intensity each
//   (final damage ~40 per hit) generates 5 × 0.4 × 35 = 70 endurance XP
//   per cycle — enough to feel meaningful without being grindy.
//
// RESIST BUFF:
//   magnitude = clamp(totalIntensity * 0.04, 0, 0.25)
//   duration  = 30 minutes
//   Stacks via the user_active_effects insert; the W3 expiry sweep prunes.
//
// All work is wrapped in try/catch — a single user's failure must not
// stop the cycle for other users. Idempotent within a tick because the
// ledger UPDATE marks rows processed before the XP grant + buff insert
// fire (same db.transaction).

import crypto from "node:crypto";
import logger from "../logger.js";
import { consumePainBudget, getPainBudget, decayProcessedPain, REGION_SKILL } from "../lib/embodied/pain.js";

export const REGION_XP_PER_PAIN_UNIT = 35;
const RESIST_BUFF_DURATION_S = 30 * 60;
const RESIST_BUFF_MAX = 0.25;

/**
 * Heartbeat handler. Registered in server.js with frequency: 20.
 *
 * @param {{ db: import('better-sqlite3').Database, state: object, tickCount: number }} ctx
 */
export async function runRepairCycle({ db, state: _state, tickCount: _tickCount } = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  // Find users with pending pain. Defensive against pain_signals being missing.
  let users;
  try {
    users = db.prepare(`
      SELECT user_id, COUNT(*) AS n
        FROM pain_signals
       WHERE processed_at IS NULL
       GROUP BY user_id
    `).all();
  } catch {
    return { ok: false, reason: "pain_signals_missing" };
  }
  if (!users || users.length === 0) {
    // Opportunistic GC even on a quiet cycle.
    const pruned = decayProcessedPain(db);
    return { ok: true, processed: 0, users: 0, pruned };
  }

  // Optional dynamic import of skill engine. We tolerate absence so the
  // cycle still drains the budget and grants resist buffs even on a
  // build that hasn't shipped skill XP yet.
  let gainSkillXP = null;
  try {
    const mod = await import("../lib/skills/skill-engine.js");
    gainSkillXP = mod.gainSkillXP;
  } catch { /* skill engine not available */ }

  let processed = 0;
  let xpGranted = 0;
  let buffsGranted = 0;

  for (const u of users) {
    try {
      const budget = consumePainBudget(db, u.user_id);
      if (budget.count === 0) continue;
      processed += budget.count;

      // Per-region XP grants.
      if (gainSkillXP) {
        for (const [region, total] of Object.entries(budget.byRegion)) {
          const skill = REGION_SKILL[region];
          if (!skill) continue;
          const xp = Math.round(Number(total) * REGION_XP_PER_PAIN_UNIT);
          if (xp <= 0) continue;
          try {
            // worldType = 'standard' fallback; the skill-engine multiplies
            // by worldMultiplier downstream from its own lookup.
            gainSkillXP(db, u.user_id, skill, "standard", xp, { worldId: null });
            xpGranted += xp;
          } catch (err) {
            try { logger.warn("repair-cycle", "xp_grant_failed", { user: u.user_id, region, error: err?.message }); } catch { /* ignore */ }
          }
        }
      }

      // Resist buff. Magnitude = totalIntensity × 0.04, capped at RESIST_BUFF_MAX.
      const magnitude = Math.min(RESIST_BUFF_MAX, Number(budget.total) * 0.04);
      if (magnitude > 0.01) {
        try {
          const now = Math.floor(Date.now() / 1000);
          db.prepare(`
            INSERT INTO user_active_effects
              (id, user_id, effect_id, kind, magnitude, source_dtu_id, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            `eff_${crypto.randomUUID()}`,
            u.user_id,
            "damage_resist",
            "buff",
            magnitude,
            null,
            now + RESIST_BUFF_DURATION_S,
          );
          buffsGranted++;
        } catch (err) {
          try { logger.warn("repair-cycle", "buff_insert_failed", { user: u.user_id, error: err?.message }); } catch { /* ignore */ }
        }
      }
    } catch (err) {
      try { logger.warn("repair-cycle", "user_failed", { user: u.user_id, error: err?.message }); } catch { /* ignore */ }
    }
  }

  // Periodic GC of fully-processed rows.
  const pruned = decayProcessedPain(db);

  return { ok: true, processed, users: users.length, xpGranted, buffsGranted, pruned };
}

// Re-export getPainBudget for routes that want a "show me my soreness"
// HUD endpoint. Not used by the cycle itself.
export { getPainBudget };
