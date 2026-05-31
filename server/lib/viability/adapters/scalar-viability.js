// server/lib/viability/adapters/scalar-viability.js
//
// Wave 2 — corpus engine #8 (longevity/viability index), the remaining scattered
// scalars instantiated on the spine. #8 is "a health-bar for everything": one
// scalar = how close to collapse. ecosystem (resource.js) + building health
// (structure.js) are already covered; this adds the last two:
//   faction momentum (−1..+1; faction-strategy flips war→truce→rebuild at ≤−0.6)
//   npc stress       (0..100; an NPC mentally breaks at ≥80)
// Each becomes a one-sided viability box read through the spine — so the live
// faction-strategy + npc-stress thresholds get a continuous "how close to the
// edge" number. Pure; behind CONCORD_VIABILITY.

import { makeConstraintSet } from "../constraint-set.js";
import { viabilityIndex } from "../viability-index.js";

export const FACTION_COLLAPSE_MOMENTUM = -0.6; // faction-strategy.js war→truce trigger
export const NPC_BREAK_STRESS = 80;            // npc-stress.js mental-break threshold

/** Faction viability 0..1 — distance from the collapse-momentum boundary (1 = ascendant). */
export function factionViability(momentum) {
  const set = makeConstraintSet([{ axis: "momentum", lo: FACTION_COLLAPSE_MOMENTUM, hi: null, scale: 1 - FACTION_COLLAPSE_MOMENTUM }]);
  return viabilityIndex({ momentum: Number(momentum) || 0 }, set);
}
export function isFactionCollapsing(momentum) {
  return (Number(momentum) || 0) <= FACTION_COLLAPSE_MOMENTUM;
}

/** NPC viability 0..1 — distance from the mental-break stress boundary (1 = serene, 0 = breaking). */
export function npcViability(stress) {
  const set = makeConstraintSet([{ axis: "stress", lo: null, hi: NPC_BREAK_STRESS, scale: NPC_BREAK_STRESS }]);
  return viabilityIndex({ stress: Math.max(0, Number(stress) || 0) }, set);
}
export function isNpcBreaking(stress) {
  return (Number(stress) || 0) >= NPC_BREAK_STRESS;
}
