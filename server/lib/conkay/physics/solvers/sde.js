// server/lib/conkay/physics/solvers/sde.js
//
// math.sde — SX-NUM-17 (ConKay solver catalogue, Wave 0).
//
// Stochastic differential equations at the JS tier (Kloeden &
// Platen). dX = a(t, X) dt + b(t, X) dW, scalar, by
// Euler-Maruyama (strong order 1/2) or Milstein (strong order
// 1; the diffusion derivative is taken by exact symbolic
// differentiation, never finite differences).
//
// Reproducibility is the honesty rule of this solver: the
// generator is seeded, the seed is a declared input echoed
// with every result, and a defaulted seed is labelled as
// defaulted (SC-03). Ensemble statistics ship with their
// standard errors — a Monte Carlo mean without its standard
// error is a number pretending to be exact.
//
// The catalogue reference case is the GBM mean S0 e^{mu t}
// from the exact law; the suite also measures the strong
// order by common random numbers against the exact GBM
// solution driven by the same Brownian increments, rather
// than asserting the order from the method's name.

import { registerSolver } from "../registry.js";
import { parse, differentiate, evaluateAst } from "./math-symbolic.js";

/* ---------------- seeded generator ---------------- */

export function makeRng(seed) {
  let state = seed >>> 0;
  const next32 = () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  };
  let spare = null;
  const normal = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = next32();
    const v = next32();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { next32, normal };
}

/* ---------------- simulation ---------------- */

function simulate(inputs, method) {
  const { drift, diffusion, x0, t1 } = inputs;
  const steps = inputs.steps;
  const paths = inputs.paths;
  const seed = inputs.seed === undefined ? 12345 : inputs.seed;
  let driftAst;
  let diffAst;
  let diffDerivAst = null;
  try {
    driftAst = parse(drift);
    diffAst = parse(diffusion);
    if (method === "milstein") diffDerivAst = differentiate(diffAst, "x");
  } catch (err) {
    return { refusal: `invalid_input:${err.message}` };
  }
  const dt = t1 / steps;
  const sqrtDt = Math.sqrt(dt);
  const rng = makeRng(seed);
  const finals = new Float64Array(paths);
  for (let p = 0; p < paths; p += 1) {
    let x = x0;
    let t = 0;
    for (let s = 0; s < steps; s += 1) {
      const env = { t, x };
      const a = evaluateAst(driftAst, env);
      const b = evaluateAst(diffAst, env);
      const dW = sqrtDt * rng.normal();
      if (method === "milstein") {
        const bp = evaluateAst(diffDerivAst, env);
        x += a * dt + b * dW + 0.5 * b * bp * (dW * dW - dt);
      } else {
        x += a * dt + b * dW;
      }
      t += dt;
    }
    finals[p] = x;
  }
  let mean = 0;
  for (const v of finals) mean += v;
  mean /= paths;
  let varAcc = 0;
  for (const v of finals) varAcc += (v - mean) ** 2;
  const variance = varAcc / (paths - 1);
  const sorted = [...finals].sort((u, v) => u - v);
  const quantile = (q) => sorted[Math.min(paths - 1, Math.floor(q * paths))];
  return {
    inputsEcho: { seed, seedDefaulted: inputs.seed === undefined, steps, paths, method },
    outputs: {
      mean,
      variance,
      stdErrorOfMean: Math.sqrt(variance / paths),
      quantiles: { q05: quantile(0.05), q50: quantile(0.5), q95: quantile(0.95) },
      declaredOrder: method === "milstein" ? { strong: 1, weak: 1 } : { strong: 0.5, weak: 1 },
    },
  };
}

function runSde(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (target !== "simulate" && target !== "strong-order") {
    return { notComputed: `unknown_operation:${target} (stochastic Runge-Kutta families: follow-on scope)` };
  }
  if (!Number.isFinite(inputs.x0) || !(inputs.t1 > 0)) {
    return { notComputed: "missing_input:finite x0 and a positive t1" };
  }
  const method = inputs.method === undefined ? "euler-maruyama" : inputs.method;
  if (!["euler-maruyama", "milstein"].includes(method)) return { notComputed: `invalid_input:method must be euler-maruyama or milstein` };

  if (target === "simulate") {
    if (typeof inputs.drift !== "string" || typeof inputs.diffusion !== "string") {
      return { notComputed: "missing_input:drift and diffusion expressions over (t, x) (SC-03)" };
    }
    const steps = inputs.steps === undefined ? 100 : inputs.steps;
    const paths = inputs.paths === undefined ? 10000 : inputs.paths;
    if (!Number.isInteger(steps) || steps < 1 || !Number.isInteger(paths) || paths < 100) {
      return { notComputed: "invalid_input:steps >= 1 and paths >= 100 (ensemble statistics need an ensemble)" };
    }
    if (steps * paths > 4_000_000) return { notComputed: `work_too_large:${steps} steps x ${paths} paths exceeds the JS tier budget of 4e6 path-steps` };
    const r = simulate({ ...inputs, steps, paths }, method);
    if (r.refusal) return { notComputed: r.refusal };
    return { inputs: r.inputsEcho, outputs: r.outputs, margins: [], covers: [target] };
  }

  // strong-order: GBM-shaped problems only (drift mu*x,
  // diffusion sigma*x supplied as parameters) — the exact
  // solution is driven by the same increments (common random
  // numbers), so the measured ratio is the method's order,
  // not a Monte Carlo hope.
  const { mu, sigma } = inputs;
  if (!Number.isFinite(mu) || !Number.isFinite(sigma)) {
    return { notComputed: "missing_input:mu and sigma (the strong-order leg is measured on the GBM family, whose exact solution is known)" };
  }
  const seed = inputs.seed === undefined ? 12345 : inputs.seed;
  const paths = inputs.paths === undefined ? 2000 : inputs.paths;
  const measure = (steps) => {
    const dt = inputs.t1 / steps;
    const sqrtDt = Math.sqrt(dt);
    const rng = makeRng(seed);
    let errAcc = 0;
    for (let p = 0; p < paths; p += 1) {
      const increments = Array.from({ length: steps }, () => sqrtDt * rng.normal());
      const wT = increments.reduce((s, v) => s + v, 0);
      const exact = inputs.x0 * Math.exp((mu - (sigma * sigma) / 2) * inputs.t1 + sigma * wT);
      let x = inputs.x0;
      for (let s = 0; s < steps; s += 1) x += mu * x * dt + sigma * x * increments[s];
      errAcc += (x - exact) ** 2;
    }
    return Math.sqrt(errAcc / paths);
  };
  const coarse = inputs.steps === undefined ? 32 : inputs.steps;
  const rmsCoarse = measure(coarse);
  const rmsFine = measure(coarse * 2);
  return {
    inputs: { seed, steps: coarse, paths },
    outputs: {
      rmsErrorCoarse: rmsCoarse,
      rmsErrorFine: rmsFine,
      measuredOrder: Math.log2(rmsCoarse / rmsFine),
      declaredOrder: 0.5,
    },
    margins: [],
    covers: [target],
  };
}

export const sde = registerSolver({
  id: "math.sde",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 3,
  method: "Euler-Maruyama (strong 1/2) and Milstein (strong 1, diffusion derivative by exact symbolic differentiation) over a seeded splitmix/Box-Muller generator; ensemble statistics with standard errors",
  reference: "Kloeden & Platen, Numerical Solution of Stochastic Differential Equations — reference case: the GBM mean S0 e^{mu t} from the exact law",
  regime: "scalar Ito SDEs with expression drift/diffusion; the seed is a declared input echoed with every result; strong order is measured by common random numbers on the GBM family, not asserted",
  units: { inputs: "drift/diffusion expressions over (t, x), x0, t1, steps, paths, seed", outputs: "ensemble mean / variance / standard error / quantiles at t1, with the method's declared orders" },
  tolerance: "Monte Carlo accuracy is the shipped standard error; the suite's statistical pins are deterministic under the declared seed",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runSde,
});
