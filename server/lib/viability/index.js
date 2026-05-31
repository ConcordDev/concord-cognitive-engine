// server/lib/viability/index.js
//
// Barrel for the viability / constraint-geometry core. Import from here:
//   import { makeConstraintSet, isFeasible } from "../viability/index.js";
//
// Wave 0 ships constraint-set + feasibility (the pay-once spine Civic Bonds'
// gate uses). Wave 1 adds viability-index + dynamics behind the same barrel.

export { makeConstraintSet, normalizeState } from "./constraint-set.js";
export { slack, slacks, isFeasible } from "./feasibility.js";
