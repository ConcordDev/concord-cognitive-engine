// server/lib/viability/adapters/resource.js
//
// Wave 2 — corpus engine #5 (ETCC unified resource-viability), "the big one,"
// as a thin instantiation of the viability spine. Every depletable pool in the
// game — NPC metabolism (hunger/thirst), player stamina/mana, mount care,
// ecosystem stock, realm treasury (sparks), inventory — shares ONE shape:
//   { stock, capacity, throughput (consumption), repairRate (regen), decayRate }.
// Viability = stock's distance from depletion; the net flow is the R≥D balance
// (repair ≥ load ⇒ sustainable); willDeplete forecasts collapse. Each subsystem
// just exposes that shape (the thin extractor is the wiring follow-on); this
// computes V + the forecast identically. Pure; behind CONCORD_VIABILITY.

import { makeConstraintSet } from "../constraint-set.js";
import { viabilityIndex } from "../viability-index.js";
import { willExit } from "../dynamics.js";

// The 6 subsystems this unifies (documentation of the ETCC reach).
export const RESOURCE_KINDS = Object.freeze([
  "metabolism", "stamina_mana", "mount_care", "ecosystem", "treasury", "inventory",
]);

/** One-sided viability box: viable while stock ≥ 0, "more is better" (scale = capacity). */
export function resourceConstraintSet(capacity) {
  const cap = Math.max(1e-9, Number(capacity) || 1);
  return makeConstraintSet([{ axis: "stock", lo: 0, hi: null, scale: cap }]);
}

/** Viability 0..1 of a pool: stock/capacity (0 = empty/collapsed, 1 = full). */
export function resourceViability({ stock, capacity }) {
  return viabilityIndex({ stock: Math.max(0, Number(stock) || 0) }, resourceConstraintSet(capacity));
}

/** Net flow per tick = repair − (throughput + decay). The R≥D balance; ≥0 = sustainable. */
export function resourceFlow({ throughput = 0, repairRate = 0, decayRate = 0 } = {}) {
  return (Number(repairRate) || 0) - (Number(throughput) || 0) - (Number(decayRate) || 0);
}

/** Is the pool sustainable — does repair meet or beat load+decay (R ≥ D)? */
export function isSustainable(params) {
  return resourceFlow(params) >= 0;
}

/**
 * Forecast collapse: does the pool deplete to 0 within `horizon` ticks under its
 * net flow? Uses the spine's willExit. Returns { exits, stepOfExit, minV }.
 * A sustainable pool (R≥D) never exits.
 */
export function willDeplete({ stock, capacity, throughput = 0, repairRate = 0, decayRate = 0 } = {}, { horizon = 50, dt = 1 } = {}) {
  const net = resourceFlow({ throughput, repairRate, decayRate });
  const set = resourceConstraintSet(capacity);
  return willExit({ stock: Math.max(0, Number(stock) || 0) }, () => ({ stock: net }), set, { horizon, dt });
}
