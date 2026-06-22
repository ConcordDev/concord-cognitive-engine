// server/emergent/hypothesis-cycle.js
//
// Tier-0 wiring for the Hypothesis Engine (#17): the engine (emergent/
// hypothesis-engine.js) was fully built but never reached by a clock, so
// hypotheses only advanced when explicit evidence was added. This bounded,
// try/catch-isolated heartbeat periodically runs checkAutoTransitions() over
// every in-flight hypothesis so confidence-/age-driven transitions
// (proposed → testing → confirmed/rejected) actually fire.
//
// Wire-up: registerHeartbeat("hypothesis-cycle", { frequency: 120, scope:
//   "global", handler: () => runHypothesisCycle() }).
// Kill-switch CONCORD_HYPOTHESIS_CYCLE=0.

import { listHypotheses, checkAutoTransitions } from "./hypothesis-engine.js";

export async function runHypothesisCycle() {
  if (process.env.CONCORD_HYPOTHESIS_CYCLE === "0") return { ok: true, skipped: "disabled" };
  let checked = 0;
  let transitioned = 0;
  try {
    for (const h of listHypotheses() || []) {
      try {
        const t = checkAutoTransitions(h.id);
        checked += 1;
        if (t?.transitioned) transitioned += 1;
      } catch { /* one hypothesis failing must not abort the pass */ }
    }
  } catch {
    return { ok: true, checked: 0, transitioned: 0 };
  }
  return { ok: true, checked, transitioned };
}

export default runHypothesisCycle;
