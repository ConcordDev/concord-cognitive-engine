// server/lib/viability/fixed-point.js
//
// Wave 5 #1 — fixed-point identity. Identity is the ATTRACTOR of recursive
// self-modeling: apply a refinement/consolidation map to a state over and over
// and a stable identity is the fixed point it converges to (Banach iteration on
// a contraction). This formalizes "what stays invariant under repeated
// consolidation" — e.g. successive MEGA/HYPER DTU summaries of the same cluster
// should settle to a stable summary (the cluster's identity), not drift. Pure,
// general (numeric or vector states via an injected distance).

const absDist = (a, b) => Math.abs(Number(a) - Number(b));

/**
 * Iterate x_{n+1} = f(x_n) until successive states are within `tol` (a fixed
 * point) or `maxIter` is hit.
 * @returns {{ fixedPoint:any, iterations:number, converged:boolean, lastDelta:number }}
 */
export function iterateToFixedPoint(f, x0, { tol = 1e-6, maxIter = 200, dist = absDist } = {}) {
  let x = x0;
  let lastDelta = Infinity;
  for (let i = 1; i <= maxIter; i++) {
    const next = f(x);
    lastDelta = dist(next, x);
    x = next;
    if (lastDelta <= tol) return { fixedPoint: x, iterations: i, converged: true, lastDelta };
  }
  return { fixedPoint: x, iterations: maxIter, converged: false, lastDelta };
}

/**
 * Has a sequence of states settled to an attractor? True when every one of the
 * last `window` successive deltas is within `tol` — the consolidation has
 * stabilized into an identity rather than drifting.
 */
export function hasConverged(sequence = [], { tol = 1e-6, window = 3, dist = absDist } = {}) {
  if (!Array.isArray(sequence) || sequence.length < window + 1) return false;
  for (let i = sequence.length - window; i < sequence.length; i++) {
    if (dist(sequence[i], sequence[i - 1]) > tol) return false;
  }
  return true;
}

/**
 * Empirically estimate whether `f` is a contraction near a region (the Lipschitz
 * constant < 1 ⇒ a unique attracting fixed point exists, Banach). Samples pairs
 * and returns { contraction, lipschitz }.
 */
export function isContraction(f, samples = [], { dist = absDist } = {}) {
  let lipschitz = 0;
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const dom = dist(samples[i], samples[j]);
      if (dom <= 0) continue;
      const ran = dist(f(samples[i]), f(samples[j]));
      lipschitz = Math.max(lipschitz, ran / dom);
    }
  }
  return { contraction: lipschitz < 1, lipschitz };
}
