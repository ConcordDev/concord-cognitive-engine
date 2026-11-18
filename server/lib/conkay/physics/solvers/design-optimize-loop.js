// server/lib/conkay/physics/solvers/design-optimize-loop.js
//
// design.optimize-loop — SX-XC-10 (ConKay solver catalogue,
// Wave 0).
//
// The design loop at the JS tier (catalogue engine:
// JS + SXE-21): single-objective optimization over a
// declared model library — Nelder-Mead (derivative-free)
// and gradient descent with Armijo backtracking (analytic
// gradients where the model declares one, central finite
// differences otherwise) — under box bounds and an
// evaluation budget whose exhaustion is reported, never
// silent; plus a multi-objective Pareto loop (weighted
// scalarization sweep + exact dominance filtering) over
// the car mass-range model. Adjoint gradients and the
// engine optimizers (SXE-21: HiGHS / IPOPT class) refuse
// by name: requires_engine_tier:sxe-21.
//
// Catalogue reference cases: Rosenbrock via the loop
// (minimum 0 at (1, 1)) and the car mass-range Pareto
// front.

import { registerSolver } from "../registry.js";

/* ---------------- model library ---------------- */

const MODELS = {
  rosenbrock: {
    dims: 2,
    f: ([x, y]) => (1 - x) ** 2 + 100 * (y - x * x) ** 2,
    grad: ([x, y]) => [
      -2 * (1 - x) - 400 * x * (y - x * x),
      200 * (y - x * x),
    ],
  },
  sphere: {
    dims: null, // any
    f: (x) => x.reduce((s, v) => s + v * v, 0),
    grad: (x) => x.map((v) => 2 * v),
  },
  quadratic: {
    dims: null,
    build: (inputs) => {
      const A = inputs.matrix;
      const b = inputs.vector;
      if (!Array.isArray(A) || !Array.isArray(b) || A.length !== b.length || A.length < 1 || A.length > 8
        || !A.every((row) => Array.isArray(row) && row.length === A.length && row.every(Number.isFinite)) || !b.every(Number.isFinite)) {
        return { error: "invalid_input:quadratic needs matrix (n x n finite) and vector (n) with n in [1, 8]" };
      }
      for (let i = 0; i < A.length; i += 1) for (let j = 0; j < A.length; j += 1) {
        if (A[i][j] !== A[j][i]) return { error: "invalid_input:quadratic matrix must be symmetric" };
      }
      return {
        dims: A.length,
        f: (x) => 0.5 * x.reduce((s, xi, i) => s + xi * A[i].reduce((s2, aij, j) => s2 + aij * x[j], 0), 0) - b.reduce((s, bi, i) => s + bi * x[i], 0),
        grad: (x) => x.map((_, i) => A[i].reduce((s, aij, j) => s + aij * x[j], 0) - b[i]),
      };
    },
  },
  polynomial: {
    dims: null,
    build: (inputs) => {
      const terms = inputs.terms;
      if (!Array.isArray(terms) || terms.length === 0 || terms.length > 32) {
        return { error: "invalid_input:polynomial needs 1..32 terms {coef, powers}" };
      }
      const n = Array.isArray(terms[0].powers) ? terms[0].powers.length : 0;
      if (n < 1 || n > 8 || !terms.every((t) => Number.isFinite(t.coef) && Array.isArray(t.powers) && t.powers.length === n
        && t.powers.every((p) => Number.isInteger(p) && p >= 0) && t.powers.reduce((a, b2) => a + b2, 0) <= 4)) {
        return { error: "invalid_input:polynomial terms need finite coef and integer powers (total degree <= 4) of one consistent dimension 1..8" };
      }
      const evalTerm = (t, x) => t.coef * t.powers.reduce((s, p, i) => s * x[i] ** p, 1);
      return {
        dims: n,
        f: (x) => terms.reduce((s, t) => s + evalTerm(t, x), 0),
        grad: (x) => x.map((_, i) => terms.reduce((s, t) => {
          if (t.powers[i] === 0) return s;
          const p = [...t.powers];
          const c = t.coef * p[i];
          p[i] -= 1;
          return s + c * p.reduce((s2, pw, j) => s2 * x[j] ** pw, 1);
        }, 0)),
      };
    },
  },
};

/* ---------------- single-objective methods ---------------- */

function nelderMead(model, start, bounds, budget, tol) {
  const n = start.length;
  const clamp = (x) => x.map((v, i) => Math.min(bounds[i][1], Math.max(bounds[i][0], v)));
  let evals = 0;
  const F = (x) => { evals += 1; return model.f(clamp(x)); };
  let simplex = [start];
  for (let i = 0; i < n; i += 1) {
    const p = [...start];
    p[i] = start[i] !== 0 ? start[i] * 1.05 : 0.25;
    simplex.push(p);
  }
  let vals = simplex.map(F);
  let iterations = 0;
  let converged = false;
  while (evals < budget) {
    iterations += 1;
    const order = vals.map((v, i) => i).sort((a, b2) => vals[a] - vals[b2]);
    simplex = order.map((i) => simplex[i]);
    vals = order.map((i) => vals[i]);
    const size = Math.max(...simplex.slice(1).map((p) => Math.max(...p.map((v, i) => Math.abs(v - simplex[0][i])))));
    if (size < tol && vals[n] - vals[0] < tol) { converged = true; break; }
    const centroid = simplex.slice(0, n).map((_, i) => simplex.slice(0, n).reduce((s, p) => s + p[i], 0) / n);
    const worst = simplex[n];
    const xr = centroid.map((ci, i) => ci + (ci - worst[i]));
    const fr = F(xr);
    if (fr < vals[0]) {
      const xe = centroid.map((ci, i) => ci + 2 * (ci - worst[i]));
      const fe = F(xe);
      if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) {
      simplex[n] = xr; vals[n] = fr;
    } else {
      const xc = centroid.map((ci, i) => ci + 0.5 * (worst[i] - ci));
      const fc = F(xc);
      if (fc < vals[n]) { simplex[n] = xc; vals[n] = fc; } else {
        for (let i = 1; i <= n; i += 1) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          vals[i] = F(simplex[i]);
        }
      }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: clamp(simplex[best]), objective: vals[best], evaluations: evals, iterations, converged };
}

function gradientDescent(model, start, bounds, budget, tol) {
  const clamp = (x) => x.map((v, i) => Math.min(bounds[i][1], Math.max(bounds[i][0], v)));
  let evals = 0;
  const F = (x) => { evals += 1; return model.f(clamp(x)); };
  const G = (x) => {
    if (model.grad) return model.grad(clamp(x));
    const g = [];
    for (let i = 0; i < x.length; i += 1) {
      const h = 1e-6 * Math.max(1, Math.abs(x[i]));
      const xp = [...x]; xp[i] += h;
      const xm = [...x]; xm[i] -= h;
      g.push((F(xp) - F(xm)) / (2 * h));
    }
    return g;
  };
  let x = clamp(start);
  let fx = F(x);
  let iterations = 0;
  let converged = false;
  let prevX = null;
  let prevG = null;
  let step = 1;
  while (evals < budget) {
    iterations += 1;
    const g = G(x);
    const gNorm = Math.sqrt(g.reduce((s, v) => s + v * v, 0));
    if (gNorm < tol) { converged = true; break; }
    // Barzilai-Borwein step from the previous move (the standard
    // cure for steepest descent's zigzag on ill-conditioned
    // quadratics), safeguarded by Armijo backtracking
    if (prevX) {
      const dx = x.map((v, i) => v - prevX[i]);
      const dg = g.map((v, i) => v - prevG[i]);
      const denom = dx.reduce((s, v, i) => s + v * dg[i], 0);
      if (denom > 0) step = dx.reduce((s, v) => s + v * v, 0) / denom;
      if (!(step > 0) || !Number.isFinite(step)) step = 1;
    }
    prevX = x;
    prevG = g;
    let s = step;
    let improved = false;
    while (s > 1e-13 && evals < budget) {
      const xn = clamp(x.map((v, i) => v - s * g[i]));
      const fn = F(xn);
      if (fn <= fx - 1e-4 * s * gNorm * gNorm) { x = xn; fx = fn; step = s; improved = true; break; }
      s /= 2;
    }
    if (!improved) break;
  }
  return { x, objective: fx, evaluations: evals, iterations, converged };
}

/* ---------------- car mass-range Pareto model ---------------- */

/* Pack-level constants, declared: specific energy 0.25
 * kWh/kg, glider 900 kg, consumption 0.12 + 6e-5*mass
 * kWh/km. mass(E) = 900 + E/0.25; range(E) = E / cons. */
const CAR = { specificEnergy: 0.25, gliderMass: 900, baseCons: 0.12, massConsCoef: 6e-5 };
const carMass = (E) => CAR.gliderMass + E / CAR.specificEnergy;
const carRange = (E) => E / (CAR.baseCons + CAR.massConsCoef * carMass(E));

function goldenMin(fn, lo, hi, budget) {
  const gr = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = fn(c);
  let fd = fn(d);
  let evals = 2;
  while (b - a > 1e-9 && evals < budget) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = fn(c); } else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = fn(d); }
    evals += 1;
  }
  const x = (a + b) / 2;
  return { x, f: fn(x), evaluations: evals + 1 };
}

function runPareto(inputs) {
  if (inputs.model !== "car-mass-range") {
    return { notComputed: `invalid_input:pareto model '${inputs.model}' (the Pareto loop serves the car-mass-range model at the JS tier; general multi-objective over arbitrary chains is requires_engine_tier:sxe-21)` };
  }
  const range = inputs.batteryRange ?? [5, 120];
  if (!Array.isArray(range) || range.length !== 2 || !(range[0] > 0) || !(range[1] > range[0])) {
    return { notComputed: "invalid_input:batteryRange must be [lo, hi] with 0 < lo < hi (kWh)" };
  }
  const weights = inputs.weights ?? 21;
  if (!Number.isInteger(weights) || weights < 2 || weights > 101) {
    return { notComputed: "invalid_input:weights (sweep count) must be an integer in [2, 101]" };
  }
  const mLo = carMass(range[0]);
  const mHi = carMass(range[1]);
  const rLo = carRange(range[0]);
  const rHi = carRange(range[1]);
  const candidates = [];
  let evals = 0;
  // weighted-scalarization optima (golden section per weight)
  for (let i = 0; i < weights; i += 1) {
    const w = i / (weights - 1);
    const scalar = (E) => w * ((carMass(E) - mLo) / (mHi - mLo)) + (1 - w) * (1 - (carRange(E) - rLo) / (rHi - rLo));
    const r = goldenMin(scalar, range[0], range[1], 500);
    evals += r.evaluations;
    candidates.push({ batteryKwh: r.x, mass: carMass(r.x), rangeKm: carRange(r.x) });
  }
  // plus a dense sweep of the design parameter itself: for this
  // one-parameter family the Pareto front IS the model curve
  // (mass and range both strictly monotonic in E), and weighted
  // sums alone recover only a few of its points — measured in
  // this build (3 of 21 weights landed interior), so the sweep
  // is a named leg of the method, not a shortcut
  const samples = Math.max(41, weights);
  for (let i = 0; i < samples; i += 1) {
    const E = range[0] + ((range[1] - range[0]) * i) / (samples - 1);
    candidates.push({ batteryKwh: E, mass: carMass(E), rangeKm: carRange(E) });
    evals += 1;
  }
  // exact dominance filter (min mass, max range), dedupe, sort
  const front = candidates.filter((p, i) => !candidates.some((q, j) => j !== i
    && q.mass <= p.mass && q.rangeKm >= p.rangeKm && (q.mass < p.mass || q.rangeKm > p.rangeKm)));
  const dedup = [];
  for (const p of front.sort((a, b) => a.mass - b.mass)) {
    if (!dedup.length || Math.abs(dedup[dedup.length - 1].batteryKwh - p.batteryKwh) > 1e-6) dedup.push(p);
  }
  return {
    outputs: {
      model: "car-mass-range",
      constants: CAR,
      front: dedup,
      evaluations: evals,
      note: "every point on the mass-range curve is non-dominated (mass and range both grow with battery energy); the front is the curve, sampled by the scalarization sweep and dominance-filtered exactly",
    },
    warnings: [],
  };
}

/* ---------------- run ---------------- */

function runOptimize(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (target === "engine") return { notComputed: "requires_engine_tier:sxe-21" };
  if (target === "pareto") {
    const r = runPareto(inputs);
    if (r.notComputed) return r;
    return { inputs, outputs: r.outputs, margins: [], covers: [target] };
  }
  if (target !== "optimize") {
    return { notComputed: `unknown_target:${target} (known: optimize, pareto, engine)` };
  }
  const spec = MODELS[inputs.model];
  if (!spec) {
    return { notComputed: `missing_input:model (one of: ${Object.keys(MODELS).join(", ")}; arbitrary chain objectives are the SXE-21 tier, requires_engine_tier:sxe-21)` };
  }
  let model = spec;
  if (spec.build) {
    const built = spec.build(inputs);
    if (built.error) return { notComputed: built.error };
    model = built;
  }
  const dims = model.dims ?? (Array.isArray(inputs.start) ? inputs.start.length : 0);
  const start = inputs.start;
  if (!Array.isArray(start) || start.length !== dims || !start.every(Number.isFinite)) {
    return { notComputed: `missing_input:start (a finite ${dims}-dimensional starting point for model ${inputs.model})` };
  }
  const bounds = inputs.bounds ?? start.map(() => [-1e6, 1e6]);
  if (!Array.isArray(bounds) || bounds.length !== dims || !bounds.every((b) => Array.isArray(b) && b.length === 2 && b[0] < b[1] && b.every(Number.isFinite))) {
    return { notComputed: "invalid_input:bounds must be [lo, hi] pairs, one per dimension, lo < hi" };
  }
  for (let i = 0; i < dims; i += 1) {
    if (start[i] < bounds[i][0] || start[i] > bounds[i][1]) {
      return { notComputed: `invalid_input:start[${i}] = ${start[i]} is outside its bounds [${bounds[i][0]}, ${bounds[i][1]}] — a design loop starts inside its declared box` };
    }
  }
  const method = inputs.method ?? "nelder-mead";
  if (!["nelder-mead", "gradient"].includes(method)) {
    return { notComputed: `invalid_input:method '${method}' (one of: nelder-mead, gradient; adjoint and engine methods are requires_engine_tier:sxe-21)` };
  }
  const budget = inputs.maxEvaluations ?? 5000;
  if (!Number.isInteger(budget) || budget < 50 || budget > 100000) {
    return { notComputed: "invalid_input:maxEvaluations must be an integer in [50, 100000]" };
  }
  const tol = inputs.tolerance ?? 1e-10;
  if (!(tol > 0)) return { notComputed: "invalid_input:tolerance must be positive" };
  const r = method === "nelder-mead"
    ? nelderMead(model, start, bounds, budget, tol)
    : gradientDescent(model, start, bounds, budget, tol);
  const warnings = [];
  if (!r.converged) {
    warnings.push(r.evaluations >= budget
      ? `evaluation budget exhausted (${budget}) before convergence — the best point found is served and flagged, not presented as an optimum`
      : "the method stopped before reaching the convergence tolerance — the best point found is served and flagged");
  }
  return {
    inputs: { model: inputs.model, ...(inputs.matrix ? { matrix: inputs.matrix } : {}), ...(inputs.vector ? { vector: inputs.vector } : {}), ...(inputs.terms ? { terms: inputs.terms } : {}), start, bounds, method, maxEvaluations: budget, tolerance: tol },
    outputs: {
      method, model: inputs.model,
      x: r.x, objective: r.objective,
      evaluations: r.evaluations, iterations: r.iterations,
      converged: r.converged,
    },
    ...(warnings.length ? { warnings } : {}),
    margins: [],
    covers: [target],
  };
}

export const designOptimizeLoop = registerSolver({
  id: "design.optimize-loop",
  version: "1.0.0",
  domain: "design",
  domains: ["design", "optimization"],
  fidelity: 3,
  method: "Nelder-Mead and Armijo gradient loops (analytic gradients where declared) over a model library under box bounds and a reported evaluation budget; weighted-scalarization Pareto sweep with exact dominance filtering (car mass-range)",
  reference: "catalogue reference cases: Rosenbrock minimum 0 at (1, 1) from the classic start (-1.2, 1); the car mass-range Pareto curve under the declared pack constants (0.25 kWh/kg, 900 kg glider)",
  regime: "JS tier (catalogue engine 'JS + SXE-21'): library models (rosenbrock, sphere, quadratic, polynomial degree <= 4), dimensions <= 8, budget <= 100000 evaluations; adjoint gradients, arbitrary chain objectives and engine optimizers are requires_engine_tier:sxe-21",
  units: { inputs: "design variables and bounds in the model's units; car model in kWh / kg / km", outputs: "optimum point and objective; Pareto front points (battery kWh, mass kg, range km)" },
  tolerance: "convergence declared on simplex size / gradient norm against the caller's tolerance; non-convergence serves the best point with a warning, never as a claimed optimum",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runOptimize,
});
