// server/lib/game-theory/replicator.js
//
// Replicator dynamics — the SCALABLE substitute for exact Nash equilibrium
// over a large or continuous population, where support enumeration
// (mixed-nash.js) is exponential in strategy count and intractable at scale.
// The replicator equation
//
//   ẋᵢ = xᵢ · (fᵢ(x) − f̄(x))
//
// grows a strategy's population share exactly when it out-earns the
// population average, and shrinks it otherwise. A rest point of this ODE that
// is dynamically stable against invasion is an evolutionarily stable strategy
// (ESS) — a stricter, differently-defined object than a Nash equilibrium of
// the underlying game (every ESS induces a Nash equilibrium of the symmetric
// game, but not every Nash equilibrium is an ESS, and the replicator dynamic
// can fail to converge at all). Some games — rock-paper-scissors is the classic
// case — have NO stable interior rest point: trajectories orbit the interior
// equilibrium forever. This module reports that honestly (`converged:false`)
// instead of claiming a fixed point that was never reached.
//
// Integrates with compute/numerical.js#rk4ODE ONE STEP AT A TIME so the
// simplex constraint (population shares non-negative, summing to 1) can be
// re-enforced after every step instead of drifting under accumulated
// floating-point error across a long horizon — a real correctness property,
// not cosmetic, since a share that goes slightly negative would make the next
// step's fitness computation meaningless.

import { rk4ODE } from "../compute/numerical.js";

const DEFAULT_DT = 0.01;
const DEFAULT_T_END = 100;
const DEFAULT_TOLERANCE = 1e-7;

function normalizeSimplex(x) {
  const clipped = x.map((v) => (v > 0 ? v : 0));
  const sum = clipped.reduce((a, b) => a + b, 0);
  if (sum <= 0) return x.map(() => 1 / x.length);
  return clipped.map((v) => v / sum);
}

/** fᵢ(x) = (A x)ᵢ — the fitness of strategy i in a symmetric population game
 * with payoff matrix A (A[i][j] = payoff to strategy i against strategy j). */
function strategyFitness(A, x) {
  return A.map((row) => row.reduce((s, aij, j) => s + aij * x[j], 0));
}

function meanFitness(f, x) {
  return f.reduce((s, fi, i) => s + fi * x[i], 0);
}

/** Right-hand side of the replicator ODE for payoff matrix A. */
function replicatorRHS(A, x) {
  const f = strategyFitness(A, x);
  const fbar = meanFitness(f, x);
  return x.map((xi, i) => xi * (f[i] - fbar));
}

/**
 * Integrate replicator dynamics for a symmetric population game with payoff
 * matrix A (n × n, A[i][j] = payoff to a player using strategy i when matched
 * against a player using strategy j).
 *
 * @param {number[][]} A
 * @param {number[]} x0 — initial population shares (normalized internally; need not already sum to 1)
 * @param {object} [opts]
 * @param {number} [opts.dt=0.01]           RK4 step size
 * @param {number} [opts.tEnd=100]          integration horizon
 * @param {number} [opts.tolerance=1e-7]    L2 per-step delta below which the state is considered a fixed point
 * @param {number} [opts.sampleEvery]       record a trajectory sample every N steps (default: spread ~500 samples across the run)
 * @returns {{converged:boolean, x:number[], reason?:'no_fixed_point_within_horizon', finalDelta:number, steps:number, trajectory:Array<{t:number,x:number[]}>}}
 */
export function replicatorDynamics(A, x0, opts = {}) {
  const n = A.length;
  if (!Array.isArray(x0) || x0.length !== n) {
    throw new Error(`replicatorDynamics: x0 length (${x0?.length}) must match A's dimension (${n})`);
  }
  const dt = opts.dt ?? DEFAULT_DT;
  const tEnd = opts.tEnd ?? DEFAULT_T_END;
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const steps = Math.max(1, Math.ceil(tEnd / dt));
  const sampleEvery = Math.max(1, opts.sampleEvery ?? (Math.floor(steps / 500) || 1));

  let x = normalizeSimplex(x0.slice());
  const trajectory = [{ t: 0, x: x.slice() }];
  let converged = false;
  let finalDelta = Infinity;
  let t = 0;
  let s = 0;
  for (; s < steps; s++) {
    const f = (_t, y) => replicatorRHS(A, y);
    const res = rk4ODE(f, x, t, t + dt, dt);
    let xNext = res[res.length - 1].y;
    xNext = normalizeSimplex(xNext);

    let deltaSq = 0;
    for (let i = 0; i < n; i++) {
      const d = xNext[i] - x[i];
      deltaSq += d * d;
    }
    const delta = Math.sqrt(deltaSq);

    x = xNext;
    t += dt;
    if ((s + 1) % sampleEvery === 0 || s === steps - 1) trajectory.push({ t, x: x.slice() });
    finalDelta = delta;
    if (delta < tolerance) { converged = true; break; }
  }

  return {
    converged,
    x,
    finalDelta,
    steps: s + 1,
    reason: converged ? undefined : "no_fixed_point_within_horizon",
    trajectory,
  };
}

export default replicatorDynamics;
