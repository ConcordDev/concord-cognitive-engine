// server/lib/viability/risk.js
//
// Engine N6 (probability/stochastic) × the viability spine: RISK = P(EXIT). The
// deterministic dynamics layer (dynamics.js#willExit) answers "does the mean
// trajectory leave the viable set?"; this answers the stochastic question —
// "what's the PROBABILITY the trajectory breaches a constraint within the
// horizon, given drift + volatility?" Makes risk first-class: a near-boundary
// state under noise is at risk even when its mean path stays inside. Composes
// monteCarloExit (N6) over the constraint set's per-axis [lo,hi] bounds. Pure
// (deterministic with an injected rng).

import { monteCarloExit } from "../probability/stochastic.js";

/**
 * Probability the state exits its viable set within the horizon.
 * @param {object} state           current per-axis values
 * @param {{box:object[]}} set     a makeConstraintSet result
 * @param {object} [opts]          { flow (per-axis drift), volatility, horizon, samples, rng }
 * @returns {{ risk:number, byAxis:Object<string,number>, mostAtRisk:string|null }}
 */
export function riskOfExit(state = {}, set, { flow = {}, volatility = 1, horizon = 20, samples = 400, rng = Math.random } = {}) {
  const byAxis = {};
  let risk = 0;
  let mostAtRisk = null;
  for (const b of (set && set.box) || []) {
    const value = Number(state[b.axis]);
    if (!Number.isFinite(value)) continue;
    const lo = b.lo == null ? -Infinity : b.lo;
    const hi = b.hi == null ? Infinity : b.hi;
    const p = monteCarloExit(value, {
      drift: Number(flow[b.axis]) || 0,
      volatility,
      lo, hi, horizon, samples, rng,
    });
    byAxis[b.axis] = p;
    if (p > risk) { risk = p; mostAtRisk = b.axis; }
  }
  return { risk, byAxis, mostAtRisk };
}
