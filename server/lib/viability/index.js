// server/lib/viability/index.js
//
// Barrel for the viability / constraint-geometry core. Import from here:
//   import { makeConstraintSet, isFeasible } from "../viability/index.js";
//
// constraint-set + feasibility (the pay-once spine Civic Bonds' gate uses) +
// viability-index + dynamics (Wave 1) — the full keystone every engine imports.

export { makeConstraintSet, normalizeState } from "./constraint-set.js";
export { slack, slacks, isFeasible } from "./feasibility.js";
export { viabilityIndex, nearestBinding, viabilityReport } from "./viability-index.js";
export { stepDynamics, willExit, inViabilityKernel } from "./dynamics.js";
