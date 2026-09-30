// server/lib/probability/monte-carlo-convergence.js
//
// Generic convergence-detection wrapper for ANY Monte Carlo estimator — not
// specific to trading, crypto, or any one domain. Reuses the mulberry32 seeded
// RNG already built for sim.js's Monte Carlo macro (domains/sim.js#makeRng)
// rather than a second copy, per this repo's "compute-don't-guess, reuse the
// existing engine" convention.
//
// The problem this solves: a single Monte Carlo run at a fixed sample count
// looks precise but says nothing about whether that count was ENOUGH — the
// estimate could still be drifting. This runs the same sampler at escalating
// sample counts and reports whether the running mean has settled (the last
// one or two step-to-step changes are within `tolerance`), e.g. "100k sims ->
// 63.1%, 500k -> 63.2%, 1M -> 63.2%, CONVERGED".
//
// Deterministic + reproducible: same seed + same sampleOne + same schedule
// => byte-identical output, every run (no Math.random anywhere in this file).

import { makeRng } from "../../domains/sim.js";

export const DEFAULT_SAMPLE_SCHEDULE = [1000, 10000, 50000, 100000, 500000, 1000000];

/**
 * @param {(rng: () => number) => number} sampleOne - draws ONE sample from
 *   whatever distribution/process the caller cares about. Must use `rng()`
 *   (uniform [0,1)) for all randomness so the run stays reproducible.
 * @param {object} [opts]
 * @param {number} [opts.seed=1]
 * @param {number[]} [opts.sampleCounts] - escalating checkpoints to measure at
 * @param {number} [opts.tolerance=0.001] - convergence band, absolute, on the running mean
 * @returns {{
 *   converged: boolean, tolerance: number, seed: number,
 *   checkpoints: Array<{n:number, mean:number, stdDev:number, delta:number|null}>,
 *   finalMean: number, finalStdDev: number, samplesUsed: number,
 * }}
 */
export function runConvergentMonteCarlo(sampleOne, opts = {}) {
  if (typeof sampleOne !== "function") {
    throw new Error("runConvergentMonteCarlo requires a sampleOne(rng) function");
  }
  const seed = Number.isFinite(opts.seed) ? opts.seed : 1;
  const schedule = Array.isArray(opts.sampleCounts) && opts.sampleCounts.length > 0
    ? Array.from(new Set(opts.sampleCounts.map((x) => Math.max(1, Math.round(x))))).sort((a, b) => a - b)
    : DEFAULT_SAMPLE_SCHEDULE;
  const tolerance = Number.isFinite(opts.tolerance) && opts.tolerance > 0 ? opts.tolerance : 0.001;

  const rng = makeRng(seed);
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  const checkpoints = [];

  for (const target of schedule) {
    while (count < target) {
      const v = Number(sampleOne(rng)) || 0;
      sum += v;
      sumSq += v * v;
      count += 1;
    }
    const mean = sum / count;
    const variance = Math.max(0, sumSq / count - mean * mean);
    const stdDev = Math.sqrt(variance);
    const prev = checkpoints[checkpoints.length - 1];
    const delta = prev ? Math.abs(mean - prev.mean) : null;
    checkpoints.push({ n: count, mean, stdDev, delta });
  }

  // Stable = the last one (or two, when available) step-to-step changes are
  // all within tolerance — guards against declaring convergence off a single
  // lucky checkpoint.
  const deltas = checkpoints.slice(1).map((c) => c.delta);
  const tail = deltas.slice(-2);
  const converged = tail.length > 0 && tail.every((d) => d !== null && d <= tolerance);

  const last = checkpoints[checkpoints.length - 1];
  return {
    converged,
    tolerance,
    seed,
    checkpoints,
    finalMean: last.mean,
    finalStdDev: last.stdDev,
    samplesUsed: last.n,
  };
}
