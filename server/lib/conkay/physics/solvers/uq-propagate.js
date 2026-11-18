// server/lib/conkay/physics/solvers/uq-propagate.js
//
// uq.propagate — SX-XC-06 (ConKay solver catalogue, Wave 0).
//
// Uncertainty propagation at the JS tier, per the CB-0820
// engine-only interim ruling: seeded Monte Carlo and Latin
// hypercube sampling over a built-in model library, beside
// the EXACT analytic propagation (moments + first-order
// Sobol indices) for the same models — so every sampled
// estimate ships next to the value it must converge to, and
// the suite pins the convergence. The general tier — a
// wrapper over arbitrary solvers with sampled Sobol indices
// — is SXE-22's (the stats-uq engine stack) and refuses by
// name: requires_engine_tier:sxe-22.
//
// All sampling is seeded and deterministic: the same inputs
// and seed reproduce the same estimates bit-for-bit, which
// is what makes a stochastic method CI-signable at all.
//
// Catalogue reference case (NIST/SEMATECH e-Handbook of
// Statistical Methods): a linear model whose propagated
// variance is analytic — Var(y) = sum a_i^2 Var(x_i).

import { registerSolver } from "../registry.js";

/* ---------------- seeded RNG (mulberry32) ---------------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Standard-normal inverse CDF (Acklam's rational approximation). */
function normInv(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285984469534e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q;
  let r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/* ---------------- distributions ---------------- */

const DISTS = {
  normal: {
    check: (v) => (Number.isFinite(v.mean) && Number.isFinite(v.std) && v.std > 0 ? null : "needs finite mean and std > 0"),
    moments: (v) => ({ mean: v.mean, variance: v.std * v.std }),
    sample: (v, rnd) => {
      // Box-Muller on the seeded stream
      const u1 = Math.max(rnd(), 1e-300);
      const u2 = rnd();
      return v.mean + v.std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    quantile: (v, p) => v.mean + v.std * normInv(p),
  },
  uniform: {
    check: (v) => (Number.isFinite(v.min) && Number.isFinite(v.max) && v.max > v.min ? null : "needs finite min < max"),
    moments: (v) => ({ mean: (v.min + v.max) / 2, variance: ((v.max - v.min) ** 2) / 12 }),
    sample: (v, rnd) => v.min + (v.max - v.min) * rnd(),
    quantile: (v, p) => v.min + (v.max - v.min) * p,
  },
  lognormal: {
    check: (v) => (Number.isFinite(v.mu) && Number.isFinite(v.sigma) && v.sigma > 0 ? null : "needs finite mu and sigma > 0"),
    moments: (v) => ({ mean: Math.exp(v.mu + (v.sigma * v.sigma) / 2), variance: (Math.exp(v.sigma * v.sigma) - 1) * Math.exp(2 * v.mu + v.sigma * v.sigma) }),
    sample: (v, rnd) => {
      const u1 = Math.max(rnd(), 1e-300);
      const u2 = rnd();
      return Math.exp(v.mu + v.sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
    },
    quantile: (v, p) => Math.exp(v.mu + v.sigma * normInv(p)),
  },
};

/* ---------------- models ---------------- */

const MODELS = {
  linear: {
    needs: "coefficients",
    apply: (xs, inputs) => (inputs.intercept ?? 0) + inputs.coefficients.reduce((s, a, i) => s + a * xs[i], 0),
    analytic: (inputs, moms) => {
      const mean = (inputs.intercept ?? 0) + inputs.coefficients.reduce((s, a, i) => s + a * moms[i].mean, 0);
      const parts = inputs.coefficients.map((a, i) => a * a * moms[i].variance);
      const variance = parts.reduce((s, v) => s + v, 0);
      return { mean, variance, sobolFirstOrder: parts.map((v) => v / variance) };
    },
  },
  product: {
    needs: null,
    apply: (xs) => xs.reduce((s, x) => s * x, 1),
    analytic: (inputs, moms) => {
      const mean = moms.reduce((s, m) => s * m.mean, 1);
      const second = moms.reduce((s, m) => s * (m.variance + m.mean * m.mean), 1);
      const variance = second - mean * mean;
      const sobolFirstOrder = moms.map((m, i) => {
        const othersSq = moms.reduce((s, m2, j) => (j === i ? s : s * m2.mean * m2.mean), 1);
        return (m.variance * othersSq) / variance;
      });
      return { mean, variance, sobolFirstOrder };
    },
  },
};

/* ---------------- run ---------------- */

function runUq(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (target === "engine") return { notComputed: "requires_engine_tier:sxe-22" };
  if (target !== "propagate") {
    return { notComputed: `unknown_target:${target} (known: propagate, engine)` };
  }
  const modelName = inputs.model;
  if (typeof modelName !== "string" || !MODELS[modelName]) {
    return { notComputed: `missing_input:model (one of: ${Object.keys(MODELS).join(", ")}; propagation around an arbitrary solver is the engine tier, requires_engine_tier:sxe-22)` };
  }
  const model = MODELS[modelName];
  const vars = inputs.variables;
  if (!Array.isArray(vars) || vars.length === 0 || vars.length > 16) {
    return { notComputed: "missing_input:variables (a non-empty array of at most 16 {name, dist, ...params})" };
  }
  for (const [i, v] of vars.entries()) {
    if (!v || typeof v.name !== "string" || !DISTS[v.dist]) {
      return { notComputed: `invalid_input:variables[${i}] needs a name and a dist in (${Object.keys(DISTS).join(", ")})` };
    }
    const bad = DISTS[v.dist].check(v);
    if (bad) return { notComputed: `invalid_input:variables[${i}] (${v.name}) ${bad}` };
  }
  if (model.needs === "coefficients") {
    if (!Array.isArray(inputs.coefficients) || inputs.coefficients.length !== vars.length || !inputs.coefficients.every(Number.isFinite)) {
      return { notComputed: "invalid_input:coefficients must be one finite number per variable for the linear model" };
    }
    if (inputs.intercept !== undefined && !Number.isFinite(inputs.intercept)) {
      return { notComputed: "invalid_input:intercept must be a finite number" };
    }
  }
  const method = inputs.method ?? "moments";
  if (!["moments", "monte-carlo", "lhs"].includes(method)) {
    return { notComputed: `invalid_input:method '${method}' (one of: moments, monte-carlo, lhs; polynomial-chaos and sampled Sobol are the engine tier, requires_engine_tier:sxe-22)` };
  }
  const moms = vars.map((v) => DISTS[v.dist].moments(v));
  const analytic = model.analytic(inputs, moms);
  const base = {
    inputs: { model: modelName, variables: vars, ...(inputs.coefficients ? { coefficients: inputs.coefficients } : {}), ...(inputs.intercept !== undefined ? { intercept: inputs.intercept } : {}), method },
    margins: [],
    covers: [target],
  };
  if (method === "moments") {
    const std = Math.sqrt(analytic.variance);
    return {
      ...base,
      outputs: {
        method, mean: analytic.mean, variance: analytic.variance, std,
        ci95: [analytic.mean - 1.959963984540054 * std, analytic.mean + 1.959963984540054 * std],
        ciBasis: "normal approximation on the exact moments",
        sobolFirstOrder: analytic.sobolFirstOrder,
        sobolBasis: "analytic (exact for this model class)",
      },
    };
  }
  // sampling methods
  const N = inputs.samples ?? 20000;
  if (!Number.isInteger(N) || N < 100 || N > 200000) {
    return { notComputed: "invalid_input:samples must be an integer in [100, 200000] at the JS tier" };
  }
  const seed = inputs.seed ?? 12345;
  if (!Number.isInteger(seed)) return { notComputed: "invalid_input:seed must be an integer (sampling is seeded and reproducible)" };
  const rnd = mulberry32(seed);
  const draws = vars.map(() => new Array(N));
  if (method === "monte-carlo") {
    for (let s = 0; s < N; s += 1) vars.forEach((v, i) => { draws[i][s] = DISTS[v.dist].sample(v, rnd); });
  } else {
    // Latin hypercube: stratified quantiles, seeded permutation per variable
    vars.forEach((v, i) => {
      const strata = Array.from({ length: N }, (_, s) => (s + rnd()) / N);
      for (let s = N - 1; s > 0; s -= 1) { const j = Math.floor(rnd() * (s + 1)); [strata[s], strata[j]] = [strata[j], strata[s]]; }
      strata.forEach((p, s) => { draws[i][s] = DISTS[v.dist].quantile(v, p); });
    });
  }
  const ys = new Array(N);
  for (let s = 0; s < N; s += 1) ys[s] = model.apply(vars.map((_, i) => draws[i][s]), inputs);
  const mean = ys.reduce((a, b) => a + b, 0) / N;
  const variance = ys.reduce((a, b) => a + (b - mean) ** 2, 0) / (N - 1);
  const sorted = [...ys].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(N - 1, Math.max(0, Math.floor(p * N)))];
  return {
    ...base,
    inputs: { ...base.inputs, samples: N, seed },
    outputs: {
      method, samples: N, seed,
      mean, variance, std: Math.sqrt(variance),
      standardErrorOfMean: Math.sqrt(variance / N),
      ci95: [pct(0.025), pct(0.975)],
      ciBasis: "sample percentiles (2.5%, 97.5%)",
      analyticMean: analytic.mean,
      analyticVariance: analytic.variance,
      sobolFirstOrder: analytic.sobolFirstOrder,
      sobolBasis: "analytic (exact for this model class); sampled Sobol indices are the engine tier",
    },
  };
}

export const uqPropagate = registerSolver({
  id: "uq.propagate",
  version: "1.0.0",
  domain: "uq",
  domains: ["uq", "math"],
  fidelity: 3,
  method: "exact analytic moment propagation + first-order Sobol indices for the library models, beside seeded Monte Carlo and Latin hypercube estimates that ship with the analytic values they must converge to (NIST/SEMATECH e-Handbook)",
  reference: "NIST/SEMATECH e-Handbook of Statistical Methods — reference case: linear model y = 2x1 + 3x2 + 1, x1 ~ N(10, 4), x2 ~ U(0, 6): analytic mean 30, variance 43, Sobol {16/43, 27/43}",
  regime: "library models (linear, product) over independent normal / uniform / lognormal inputs, at most 16 variables; samples 100..200000, seeded; propagation around arbitrary solvers, PCE and sampled Sobol are the SXE-22 engine tier, refused by name",
  units: { inputs: "model name, variable distributions with parameters, coefficients (dimensionless declarations)", outputs: "mean, variance, std, 95% CI, first-order Sobol indices (in the model's units / dimensionless)" },
  tolerance: "analytic values exact; sampled estimates deterministic under the seed and pinned in CI within 5 standard errors of the analytic values",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runUq,
});
