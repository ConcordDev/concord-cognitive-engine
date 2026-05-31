// server/lib/social/addiction.js
//
// Slice-of-Life SL4 (core) — addiction as VIABILITY-DECAY. The load-bearing
// vice mechanic: a substance builds dependence with use and sheds it with
// abstinence; the addiction debuff's MAGNITUDE is the viability distance toward
// a "withdrawal/collapse" boundary — computed through the actual viability spine
// (`lib/viability`), so vice is the same R≥D math as everything else (use = the
// load that drives you toward the boundary; abstinence = the repair). Pure,
// deterministic. The user_active_effects debuff write + intoxication
// generalization + decay heartbeat are the wiring follow-on; this is the math.

import { makeConstraintSet } from "../viability/constraint-set.js";
import { viabilityIndex } from "../viability/viability-index.js";

// Small substance catalog. opinionJudgment = how hard vice-disapproving NPCs dock
// you (SL4 NPC judgment, fed to recordOpinionEvent at the call site).
export const SUBSTANCES = Object.freeze({
  alcohol:   { perUse: 0.10, decayPerTick: 0.02,  withdrawalThreshold: 1.0, opinionJudgment: -2 },
  stimulant: { perUse: 0.15, decayPerTick: 0.012, withdrawalThreshold: 1.0, opinionJudgment: -4 },
  opiate:    { perUse: 0.22, decayPerTick: 0.008, withdrawalThreshold: 1.0, opinionJudgment: -7 },
});

function _sub(substance) {
  return typeof substance === "string" ? SUBSTANCES[substance] : substance;
}

/** The viability constraint: viable while dependence stays below the withdrawal threshold. */
export function addictionConstraintSet(substance) {
  const s = _sub(substance) || SUBSTANCES.alcohol;
  return makeConstraintSet([{ axis: "dependence", lo: null, hi: s.withdrawalThreshold, scale: s.withdrawalThreshold }]);
}

/** Dependence after one use (capped at the threshold). */
export function recordUse(dependence, substance) {
  const s = _sub(substance); if (!s) return dependence;
  return Math.min(s.withdrawalThreshold, Math.max(0, Number(dependence) || 0) + s.perUse);
}

/** Dependence after `ticks` of abstinence (decays toward 0). */
export function tickAbstinence(dependence, substance, ticks = 1) {
  const s = _sub(substance); if (!s) return dependence;
  return Math.max(0, (Number(dependence) || 0) - s.decayPerTick * Math.max(0, ticks));
}

/**
 * Addiction debuff magnitude ∈ [0,1] = 1 − viabilityIndex(dependence): 0 when
 * clean (deep in the viable interior), → 1 as dependence approaches the
 * withdrawal boundary. THIS is the managed-debuff magnitude the
 * user_active_effects row carries — derived through the viability spine.
 */
export function addictionMagnitude(dependence, substance) {
  const set = addictionConstraintSet(substance);
  const V = viabilityIndex({ dependence: Math.max(0, Number(dependence) || 0) }, set);
  return Math.max(0, Math.min(1, 1 - V));
}

/** Whether dependence has crossed into withdrawal (the collapse boundary). */
export function inWithdrawal(dependence, substance) {
  const s = _sub(substance); if (!s) return false;
  return (Number(dependence) || 0) >= s.withdrawalThreshold;
}
