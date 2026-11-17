// server/lib/conkay/physics/solvers/quadrature.js
//
// math.quadrature — SX-NUM-07 (ConKay solver catalogue, Wave 0).
//
// Definite integration over a finite interval at the JS tier.
// The integrand arrives as DATA — an expression in the
// math.symbolic grammar — so it is the same surface the rest of
// the family evaluates, with exact parsing and no code input.
//
//   integrate — tanh-sinh (double-exponential) quadrature: the
//               method in the row's own list that decides endpoint
//               singularities; the reference case integral of
//               x^-1/2 over [0, 1] = 2 is exactly that shape.
//   simpson   — adaptive Simpson with Richardson error control,
//               for integrands smooth on the closed interval.
//
// VALIDITY ENVELOPE (the row's own rule): an answer ships only
// when its own error estimate is <= the declared tolerance
// (input tol, default 1e-10, always echoed). Otherwise the call
// is NOT_COMPUTED error_estimate_above_tolerance with the final
// estimate named — a number whose error bar misses its tolerance
// is not an answer. Infinite intervals and multidimensional
// integrals (cubature / QMC) are named scopes, not silent
// transforms.

import { registerSolver } from "../registry.js";
import { parse, evaluateAst } from "./math-symbolic.js";

const DEFAULT_TOL = 1e-10;

function makeIntegrand(inputs) {
  const expr = inputs.expression;
  if (typeof expr !== "string" || !expr.trim()) {
    return { refusal: "missing_input:expression (SC-03: no integrand assumed)" };
  }
  const variable = typeof inputs.variable === "string" && inputs.variable ? inputs.variable : "x";
  let ast;
  try {
    ast = parse(expr);
  } catch (err) {
    return { refusal: `invalid_input:expression ${err.message}` };
  }
  const f = (x) => {
    const v = evaluateAst(ast, { [variable]: x });
    if (!Number.isFinite(v)) throw new Error(`integrand is not finite at ${variable} = ${x}`);
    return v;
  };
  return { f, variable };
}

function tanhSinh(f, a, b, tol) {
  const c = (a + b) / 2;
  const d = (b - a) / 2;
  const evalAt = (t) => {
    const sinhT = Math.sinh(t);
    const phi = Math.tanh((Math.PI / 2) * sinhT);
    const x = c + d * phi;
    const coshT = Math.cosh(t);
    const denom = Math.cosh((Math.PI / 2) * sinhT);
    const dphi = ((Math.PI / 2) * coshT) / (denom * denom);
    return { x, w: d * dphi };
  };
  let prev = null;
  let estimate = Infinity;
  for (let level = 0; level <= 8; level += 1) {
    const h = 0.5 / 2 ** level;
    let sum = 0;
    for (let k = 0; k * h <= 4; k += 1) {
      const t = k * h;
      let add = 0;
      const p = evalAt(t);
      if (p.w > 0 && p.x > a && p.x < b) add += p.w * f(p.x);
      if (k > 0) {
        const q = evalAt(-t);
        if (q.w > 0 && q.x > a && q.x < b) add += q.w * f(q.x);
      }
      sum += add;
      if (k > 0 && t > 1 && Math.abs(add) < 1e-17 * Math.max(1, Math.abs(sum))) break;
    }
    const value = h * sum;
    if (prev !== null) {
      estimate = Math.abs(value - prev);
      if (estimate <= tol * Math.max(1, Math.abs(value))) {
        return { value, estimate, level };
      }
    }
    prev = value;
  }
  return { refusal: `error_estimate_above_tolerance:tanh-sinh estimate ${estimate} did not reach tol ${tol} within the level cap` };
}

function adaptiveSimpson(f, a, b, tol) {
  const S = (fa, fm, fb, lo, hi) => ((hi - lo) / 6) * (fa + 4 * fm + fb);
  let totalErr = 0;
  let exhausted = false;
  function recurse(lo, hi, fa, fm, fb, whole, eps, depth) {
    const mid = (lo + hi) / 2;
    const flm = f((lo + mid) / 2);
    const frm = f((mid + hi) / 2);
    const left = S(fa, flm, fm, lo, mid);
    const right = S(fm, frm, fb, mid, hi);
    const err = Math.abs(left + right - whole) / 15;
    if (err <= eps || depth <= 0) {
      if (err > eps) exhausted = true;
      totalErr += err;
      return left + right + (left + right - whole) / 15;
    }
    return recurse(lo, mid, fa, flm, fm, left, eps / 2, depth - 1)
      + recurse(mid, hi, fm, frm, fb, right, eps / 2, depth - 1);
  }
  const fa = f(a);
  const fb = f(b);
  const fm = f((a + b) / 2);
  const value = recurse(a, b, fa, fm, fb, S(fa, fm, fb, a, b), tol, 20);
  return { value, estimate: totalErr, exhausted };
}

function runQuadrature(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (!["integrate", "simpson"].includes(target)) {
    return { notComputed: `unknown_operation:${target} (multidimensional cubature / QMC is a named separate scope)` };
  }
  const { a, b } = inputs;
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { notComputed: "missing_input:finite a and b (infinite intervals are a named scope: declare a finite truncation or a substitution yourself — none is applied silently)" };
  }
  if (a === b) return { notComputed: "invalid_input:empty interval (a == b)" };
  const tol = inputs.tol === undefined ? DEFAULT_TOL : inputs.tol;
  if (!(Number.isFinite(tol) && tol > 0)) return { notComputed: "invalid_input:tol must be a positive number" };
  const made = makeIntegrand(inputs);
  if (made.refusal) return { notComputed: made.refusal };
  const sign = a < b ? 1 : -1;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let r;
  try {
    r = target === "integrate"
      ? tanhSinh(made.f, lo, hi, tol)
      : adaptiveSimpson(made.f, lo, hi, tol);
  } catch (err) {
    return { notComputed: `integrand_not_finite:${err.message}` };
  }
  if (r.refusal) return { notComputed: r.refusal };
  if (target === "simpson" && r.estimate > tol) {
    // the row's validity envelope, applied to the accumulated
    // leaf-estimate sum the method actually reports
    return { notComputed: `error_estimate_above_tolerance:adaptive simpson estimate ${r.estimate} exceeds tol ${tol}${r.exhausted ? " (depth cap reached)" : ""}` };
  }
  return {
    inputs: { expression: inputs.expression, variable: made.variable, a, b, tol },
    outputs: {
      value: sign * r.value,
      errorEstimate: r.estimate,
      method: target === "integrate" ? "tanh-sinh (double exponential)" : "adaptive simpson",
      ...(r.level !== undefined ? { refinementLevel: r.level } : {}),
    },
    margins: [],
    covers: [target],
  };
}

export const quadrature = registerSolver({
  id: "math.quadrature",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 3,
  method: "tanh-sinh (double-exponential) quadrature and adaptive Simpson over the math.symbolic grammar; QUADPACK Gauss-Kronrod, Clenshaw-Curtis, cubature and QMC are named follow-on scopes",
  reference: "NIST DLMF integral identities; Mori & Sugihara on the double-exponential transformation",
  regime: "finite intervals; endpoint algebraic singularities decidable by tanh-sinh; validity envelope: the reported error estimate must meet the declared tolerance",
  units: { inputs: "integrand expression, variable, finite a and b, tol", outputs: "integral value with its error estimate and method" },
  tolerance: "declared per call (default 1e-10); an answer ships only when its error estimate <= tol",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runQuadrature,
});
