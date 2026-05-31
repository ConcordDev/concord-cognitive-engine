// server/lib/viability/dynamics.js
//
// Engine #2 (forward-looking) — viability-kernel approximation. Given a flow
// (the natural decay/throughput of a subsystem), does the trajectory exit the
// feasible set within a horizon? This is the principled replacement for
// world-crisis.js's fixed 72h timers: "will this collapse soon," not "a timer
// expired." Pure + deterministic.

import { isFeasible } from "./feasibility.js";
import { viabilityIndex } from "./viability-index.js";

/** Euler step: next[axis] = state[axis] + flow[axis]*dt. flow(state)→{axis:dAxis/dt}. */
export function stepDynamics(state, flow, dt = 1) {
  const f = typeof flow === "function" ? (flow(state) || {}) : (flow || {});
  const next = { ...state };
  for (const axis of Object.keys(f)) {
    next[axis] = Number(state[axis] ?? 0) + Number(f[axis] || 0) * dt;
  }
  return next;
}

/**
 * Simulate forward under `flow`; report whether/when the trajectory exits the
 * feasible set, the minimum V reached, and the V trajectory (for "trending
 * toward collapse"). A conservative kernel under-estimate (natural flow only,
 * no control).
 */
export function willExit(state, flow, set, { horizon = 24, dt = 1 } = {}) {
  let s = { ...state };
  let minV = viabilityIndex(s, set);
  const trajectory = [minV];
  for (let i = 1; i <= horizon; i++) {
    s = stepDynamics(s, flow, dt);
    const v = viabilityIndex(s, set);
    trajectory.push(v);
    if (v < minV) minV = v;
    if (!isFeasible(s, set).feasible) {
      return { exits: true, stepOfExit: i, minV, trajectory };
    }
  }
  return { exits: false, stepOfExit: null, minV, trajectory };
}

/** Coarse viability-kernel membership: no short-horizon natural flow drives it out. */
export function inViabilityKernel(state, flow, set, opts = {}) {
  return !willExit(state, flow, set, opts).exits;
}
