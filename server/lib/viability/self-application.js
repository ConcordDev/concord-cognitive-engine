// server/lib/viability/self-application.js
//
// Wave 5 #33 — self-application: the formal loop closes when the engine applies
// its OWN viability analysis to itself. The same constraint-geometry that judges
// whether a creature, faction, or realm is in its viable set judges whether the
// cognitive OS is in ITS viable set — heartbeat still ticking, suite green, error
// rate bounded, memory headroom intact. A reflexive "health bar for the system,"
// computed through the identical spine. Pure; composes makeConstraintSet +
// viabilityIndex + nearestBinding.

import { makeConstraintSet } from "./constraint-set.js";
import { viabilityIndex, nearestBinding } from "./viability-index.js";

const num = (x, d) => (Number.isFinite(Number(x)) ? Number(x) : d);

// The cognitive OS's operational viability envelope.
export const SYSTEM_ENVELOPE = [
  { axis: "heartbeatHz",  lo: 0.033, hi: null, scale: 0.066 }, // must keep ticking (≥ ~1 / 30s)
  { axis: "testPassRate", lo: 0.90,  hi: null, scale: 0.10 },  // suite green
  { axis: "errorRate",    lo: null,  hi: 0.05, scale: 0.05 },  // errors bounded
  { axis: "memoryHeadroom", lo: 0.10, hi: null, scale: 0.90 }, // headroom = 1 − pressure
];

/**
 * The system's own viability index — the reflexive loop. Metrics default to a
 * healthy baseline so a partial read still produces a sane number.
 * @returns {{ viability:number, healthy:boolean, binding:object|null, state:object }}
 */
export function systemViability(metrics = {}) {
  const state = {
    heartbeatHz:    num(metrics.heartbeatHz, 0.066),
    testPassRate:   num(metrics.testPassRate, 1),
    errorRate:      num(metrics.errorRate, 0),
    memoryHeadroom: 1 - num(metrics.memoryPressure, 0),
  };
  const set = makeConstraintSet(SYSTEM_ENVELOPE);
  const viability = viabilityIndex(state, set);
  const binding = nearestBinding(state, set);
  return { viability, healthy: viability > 0, binding, state };
}
