// server/lib/viability/adapters/creature-envelope.js
//
// Wave 2 — corpus engines #6 (multi-axis constraint-cone) + #9 (astrobiology /
// habitability), as a thin INSTANTIATION of the viability spine. A creature is
// viable only inside a cone over the environment's axes (temperature, humidity,
// light) — exactly a constraint-set. `creatureViability` = how deep inside its
// survivable envelope (0 = at the edge / dying, 1 = ideal); `habitable` = can it
// live here at all (Slater feasibility). This is the principled replacement for
// fauna-spawner's string-pattern `_signalModifierFor` (legacy stays the
// CONCORD_VIABILITY-off fallback). Pure; reads the embodied-signals shape
// { temperature, humidity, light } and the viability core. Behind CONCORD_VIABILITY.

import { makeConstraintSet } from "../constraint-set.js";
import { viabilityIndex, viabilityReport } from "../viability-index.js";
import { isFeasible } from "../feasibility.js";

// Climate-affinity envelopes (the cone per ecological niche). Axes match the
// Layer-7 signal keys. lo/hi in °C, humidity %, light 0..1. An unknown affinity
// → no constraints → always viable (degrade-graceful, never penalises).
export const AFFINITY_ENVELOPES = Object.freeze({
  arctic:    [{ axis: "temperature", lo: -45, hi: 12 }],
  temperate: [{ axis: "temperature", lo: -5, hi: 32 }, { axis: "humidity", lo: 20, hi: 90 }],
  desert:    [{ axis: "temperature", lo: 12, hi: 58 }, { axis: "humidity", lo: 0, hi: 45 }],
  tropical:  [{ axis: "temperature", lo: 18, hi: 42 }, { axis: "humidity", lo: 55, hi: 100 }],
  aquatic:   [{ axis: "humidity", lo: 65, hi: 100 }],           // humidity as a water proxy
  cave:      [{ axis: "light", lo: 0, hi: 0.35 }, { axis: "temperature", lo: 2, hi: 25 }],
  volcanic:  [{ axis: "temperature", lo: 30, hi: 90 }],
});

// Envelope semantics: a creature at the CENTRE of its band is ideal (V≈1). For a
// two-sided box the normalized distance-to-boundary maxes at 0.5 (half the
// width), so we saturate at 0.5 — center → V 1, edge → V 0.
const ENVELOPE_SAT = 0.5;
function _opts(opts) { return { saturationScale: ENVELOPE_SAT, ...opts }; }

/** The survival constraint-cone for a climate affinity (empty = unconstrained). */
export function survivalCone(affinity) {
  return makeConstraintSet(AFFINITY_ENVELOPES[affinity] || []);
}

/** Viability index 0..1 of a creature of `affinity` in the given environment signals. */
export function creatureViability(affinity, signals = {}, opts = {}) {
  return viabilityIndex(signals, survivalCone(affinity), _opts(opts));
}

/** Can a creature of `affinity` survive here at all? { feasible, hasInterior, violations }. */
export function habitable(affinity, signals = {}) {
  return isFeasible(signals, survivalCone(affinity));
}

/** Full report (V + nearest-binding axis = the limiting factor). */
export function envelopeReport(affinity, signals = {}, opts = {}) {
  return viabilityReport(signals, survivalCone(affinity), _opts(opts));
}

/**
 * Map the viability index onto the legacy spawn-density multiplier range the
 * fauna-spawner uses (≈0.5×–1.4×), so the principled cone can drop in where
 * `_signalModifierFor` returned a string-heuristic number. V=0 → 0.5×, V=1 → 1.4×.
 */
export function spawnDensityModifier(affinity, signals = {}) {
  const v = creatureViability(affinity, signals);
  return 0.5 + v * 0.9;
}
