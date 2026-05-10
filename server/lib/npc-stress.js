// server/lib/npc-stress.js
//
// Sprint C / Track A1 — internal pressure for every NPC.
//
// Stress is a 0..100 integer per NPC. Accrues from grudges, preoccupation
// switches, faction war membership, heir deaths, ritual failures. At 80+,
// a mental break locks a coping_trait for 7 in-game days. Coping flows into:
//   - narrative-bridge.js#buildNPCTraits (extra prompt line)
//   - faction-strategy.js#pickMove (paranoid/reckless leader bias)
//   - npc-routines.js (drinker schedule overrides)
//
// All accrual paths funnel through bumpStress(); the routine cycle calls
// decayStress() once per pass to bleed everything toward 30 baseline.

import logger from "../logger.js";

const BREAK_THRESHOLD = 80;
const BASELINE = 30;
const COPING_DAYS = 7;
const SECONDS_PER_DAY = 86400;

// Accrual table — referenced by recordStressEvent. Keep narrative aligned
// with whatever caller passes in eventKind.
const STRESS_DELTA = {
  grudge_severe: 5,         // grudge severity ≥ 6
  preoccupation_switch: 3,  // faction phase change OR personal_loss replaces previous
  faction_war_tick: 2,      // each cycle while faction is at war
  heir_death: 15,           // child / heir dies
  ritual_failure: 8,        // failed ceremony / botched ritual
  betrayal: 10,             // ally betrayed them
  combat_routed: 6,         // lost a fight badly
  exile: 12,                // banished from kingdom (Track D)
  scheme_exposed: 9,        // your scheme got discovered (Track A4)
};

const COPING_TRAITS = ["drink", "reckless", "paranoid", "withdraw", "cruel"];

/**
 * Pick a coping trait deterministically from npcId + break occasion so two
 * breaks in close succession don't ping-pong the trait. The mod-5 pick is
 * stable as long as the inputs are. Real "personality" comes from the
 * authored archetype reading the trait downstream, not from the pick.
 */
function pickCopingTrait(npcId, breakAt) {
  const seed = `${npcId}::${Math.floor(breakAt / SECONDS_PER_DAY)}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return COPING_TRAITS[Math.abs(h) % COPING_TRAITS.length];
}

function ensureRow(db, npcId) {
  db.prepare(`
    INSERT INTO npc_stress (npc_id, stress, last_decay_at, updated_at)
    VALUES (?, ?, unixepoch(), unixepoch())
    ON CONFLICT(npc_id) DO NOTHING
  `).run(npcId, BASELINE);
}

export function getStress(db, npcId) {
  if (!db || !npcId) return null;
  ensureRow(db, npcId);
  return db.prepare(`
    SELECT stress, coping_trait, last_break_at, coping_until
    FROM npc_stress WHERE npc_id = ?
  `).get(npcId);
}

/**
 * Bump an NPC's stress by an event's delta. If the bump crosses the break
 * threshold, lock a coping trait for COPING_DAYS. Returns { stress, broke,
 * copingTrait? }.
 */
export function bumpStress(db, npcId, eventKind, magnitudeOverride = null) {
  if (!db || !npcId || !eventKind) return { ok: false, reason: "missing_inputs" };
  const delta = magnitudeOverride != null ? magnitudeOverride : (STRESS_DELTA[eventKind] ?? 0);
  if (delta === 0) return { ok: true, action: "noop" };
  ensureRow(db, npcId);

  const before = db.prepare(`SELECT stress, coping_trait, coping_until FROM npc_stress WHERE npc_id = ?`).get(npcId);
  const next = Math.max(0, Math.min(100, (before?.stress ?? BASELINE) + delta));
  const now = Math.floor(Date.now() / 1000);

  let broke = false;
  let copingTrait = before?.coping_trait ?? null;
  let copingUntil = before?.coping_until ?? null;

  // Mental break: only re-lock if previous lock has expired (or never existed).
  if (next >= BREAK_THRESHOLD && (!copingUntil || copingUntil < now)) {
    copingTrait = pickCopingTrait(npcId, now);
    copingUntil = now + COPING_DAYS * SECONDS_PER_DAY;
    broke = true;
    db.prepare(`
      UPDATE npc_stress
      SET stress = ?, coping_trait = ?, last_break_at = ?, coping_until = ?, updated_at = unixepoch()
      WHERE npc_id = ?
    `).run(next, copingTrait, now, copingUntil, npcId);
    try { logger.info?.("npc_stress_break", { npcId, eventKind, stress: next, copingTrait }); } catch { /* noop */ }
  } else {
    db.prepare(`
      UPDATE npc_stress SET stress = ?, updated_at = unixepoch() WHERE npc_id = ?
    `).run(next, npcId);
  }

  return { ok: true, action: "bumped", stress: next, delta, broke, copingTrait, copingUntil };
}

/**
 * Daily decay sweep — runs from the routine cycle. Decays 1/day toward 30.
 * Coping traits expire when coping_until < now.
 */
export function decayStress(db) {
  if (!db) return { ok: false, reason: "no_db" };
  const r = db.prepare(`
    UPDATE npc_stress
    SET
      stress = CASE
        WHEN stress > ${BASELINE} AND last_decay_at < (unixepoch() - ${SECONDS_PER_DAY}) THEN stress - 1
        WHEN stress < ${BASELINE} AND last_decay_at < (unixepoch() - ${SECONDS_PER_DAY}) THEN stress + 1
        ELSE stress
      END,
      last_decay_at = CASE
        WHEN last_decay_at < (unixepoch() - ${SECONDS_PER_DAY}) THEN unixepoch()
        ELSE last_decay_at
      END,
      coping_trait = CASE
        WHEN coping_until IS NOT NULL AND coping_until < unixepoch() THEN NULL
        ELSE coping_trait
      END,
      coping_until = CASE
        WHEN coping_until IS NOT NULL AND coping_until < unixepoch() THEN NULL
        ELSE coping_until
      END,
      updated_at = unixepoch()
    WHERE last_decay_at < (unixepoch() - ${SECONDS_PER_DAY})
       OR (coping_until IS NOT NULL AND coping_until < unixepoch())
  `).run();
  return { ok: true, touched: r.changes };
}

/**
 * pickMove bias signal — paranoid leaders bias toward RAID/DECLARE_WAR;
 * reckless leaders bias toward EXPAND. Returned as additive weights for
 * the seeded RNG in faction-strategy.js#pickMove. Caller is responsible
 * for applying — this only computes.
 */
export function copingMoveBias(copingTrait) {
  switch (copingTrait) {
    case "paranoid": return { RAID: +0.4, DECLARE_WAR: +0.3, SEEK_TRUCE: -0.3 };
    case "reckless": return { EXPAND: +0.4, RAID: +0.2, CONSOLIDATE: -0.3 };
    case "cruel":    return { RAID: +0.3, DECLARE_WAR: +0.2 };
    case "withdraw": return { CONSOLIDATE: +0.4, ISOLATION: +0.3, EXPAND: -0.3 };
    case "drink":    return { CONSOLIDATE: +0.2 };
    default: return {};
  }
}

/**
 * Trait line for narrative-bridge.js#buildNPCTraits. Returns one short
 * string when the NPC is currently in a coping window; null otherwise.
 */
export function copingTraitLine(stressRow) {
  if (!stressRow?.coping_trait) return null;
  const now = Math.floor(Date.now() / 1000);
  if (stressRow.coping_until && stressRow.coping_until < now) return null;
  switch (stressRow.coping_trait) {
    case "drink":    return "Has been drinking heavily; their hands shake.";
    case "reckless": return "Snapped under pressure — speaks and acts without thinking.";
    case "paranoid": return "Has not slept well; sees plots in every shadow.";
    case "withdraw": return "Has withdrawn into themselves; replies are short and distant.";
    case "cruel":    return "Has turned cruel; takes pleasure in others' setbacks.";
    default: return null;
  }
}

export const STRESS_CONSTANTS = Object.freeze({
  BREAK_THRESHOLD,
  BASELINE,
  COPING_DAYS,
  STRESS_DELTA,
  COPING_TRAITS,
});
