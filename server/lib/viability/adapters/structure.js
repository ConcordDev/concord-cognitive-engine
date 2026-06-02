// server/lib/viability/adapters/structure.js
//
// Wave 2 — corpus engine #4 (robust-vs-brittle), instantiated on the viability
// spine + the N7 materials core. A structure is viable while its health stays
// above 0; a hit's effect on that health depends on the MATERIAL — a ductile
// material (steel) yields and degrades gracefully (a warning before failure), a
// brittle one (glass, stone) shatters suddenly. This is why some buildings
// survive shocks and others collapse, and it feeds the existing
// applyStructuralStress (standing→damaged→collapsed). Pure; composes
// lib/materials/stress.js. Behind CONCORD_VIABILITY.

import { makeConstraintSet } from "../constraint-set.js";
import { viabilityIndex } from "../viability-index.js";
import { MATERIALS, stressResponse, isBrittle } from "../../materials/stress.js";

/** Structural viability 0..1 from health_pct (1 pristine → 0 collapsed). */
export function structuralViability(healthPct) {
  return viabilityIndex({ health: Math.max(0, Number(healthPct) || 0) }, makeConstraintSet([{ axis: "health", lo: 0, hi: null, scale: 1 }]));
}

/** Robustness 0..1 — how gracefully a material absorbs shock (ductile high, brittle low). */
export function robustness(material) {
  const m = MATERIALS[material];
  return m ? Math.max(0, Math.min(1, 1 - m.brittleness)) : 0.5;
}

/**
 * Apply a hit of `stress` (in material units) to a structure of `material` at
 * `healthPct`. Returns the new health + the failure mode:
 *   elastic   → no damage (springs back)
 *   yielding  → gradual damage, softened by robustness (the ductile "warning")
 *   fracture  → brittle: SHATTERS (health → 0); ductile: heavy but survivable damage
 * The #4 thesis in one function: robust structures degrade, brittle ones snap.
 */
export function absorbHit(material, healthPct, stress) {
  const h = Math.max(0, Math.min(1, Number(healthPct ?? 1)));
  const resp = stressResponse(material, stress);
  const robust = robustness(material);
  let dmg = 0;
  if (resp.state === "yielding") {
    dmg = resp.ratio * 0.18 * (1 - 0.5 * robust); // proportional, softened by ductility
  } else if (resp.state === "fracture") {
    dmg = isBrittle(material) ? 1.0 : 0.35 * (1 - 0.4 * robust); // shatter vs heavy-but-survivable
  }
  const newHealthPct = Math.max(0, Math.min(1, h - dmg));
  return {
    newHealthPct,
    state: resp.state,
    fractured: resp.failed,
    shattered: !!(resp.failed && isBrittle(material)),
    viability: structuralViability(newHealthPct),
  };
}
