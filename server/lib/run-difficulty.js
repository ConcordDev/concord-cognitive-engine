// server/lib/run-difficulty.js
//
// C2 / F4.2 — difficulty tiers for run-modes. difficulty.js#applyDifficulty was
// wired only to world-bosses; this wraps it so roguelite / horde / extraction
// can run at a player-selected tier (finder → normal → heroic → mythic), gated
// by a prior clear, scaling enemy count/health/loot. Thin reuse of the existing
// difficulty substrate — no new tier system.

import { getModifier, tierUnlockedFor, recordClear, applyDifficulty, TIER_ORDER } from "./difficulty.js";

/** The encounter id a run-mode uses for tier-gating (one chain per mode). */
export function runEncounterId(runKind) {
  return `run:${runKind}`;
}

/**
 * Resolve a run's difficulty: validate the tier is unlocked for this mode, and
 * return its modifier. Defaults to 'finder' (always unlocked). Returns
 * { ok, tier, modifier } or { ok:false, reason }.
 */
export function resolveRunDifficulty(db, userId, runKind, tier = "finder") {
  if (!TIER_ORDER.includes(tier)) return { ok: false, reason: "invalid_tier", validTiers: TIER_ORDER };
  const encounterId = runEncounterId(runKind);
  if (!tierUnlockedFor(db, userId, encounterId, tier)) {
    return { ok: false, reason: "tier_locked", tier, needsClearOf: encounterId };
  }
  const modifier = getModifier(db, tier);
  // finder is the baseline (identity scaling) — it works even on a minimal
  // build without the difficulty_modifiers table. Higher tiers need the row.
  if (!modifier) {
    if (tier === "finder") return { ok: true, tier, modifier: null };
    return { ok: false, reason: "no_modifier_row", tier };
  }
  return { ok: true, tier, modifier };
}

/** Scale a run encounter (enemy stats) by the resolved tier modifier. */
export function scaleRunEncounter(encounter, modifier) {
  return applyDifficulty(encounter, modifier);
}

/** Record a clear of a run mode at a tier (unlocks the next tier). */
export function recordRunClear(db, userId, runKind, tier) {
  return recordClear(db, userId, runEncounterId(runKind), tier);
}

export { TIER_ORDER };
