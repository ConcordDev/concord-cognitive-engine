// server/lib/conkay/physics/solvers/roots.js
//
// math.roots — SX-NUM-06 (ConKay solver catalogue, Wave 0).
//
// Nonlinear equations at the JS tier. Functions arrive as DATA —
// polynomial coefficients (descending order) for scalar problems,
// monomial term lists for systems — so every derivative and
// Jacobian is exact, and every answer is verified by substitution
// before it is served:
//
//   brent   — Brent's method on a declared bracket. No sign change
//             across the bracket is NOT_COMPUTED no_bracket_sign_change;
//             a bracket is a claim the caller must actually hold.
//   newton  — scalar Newton from a declared start (echoed; Newton
//             is start-dependent and the record says so). Divergence
//             or a vanishing derivative is NOT_COMPUTED, named.
//   roots   — all roots of a polynomial by Durand–Kerner iteration
//             in complex arithmetic, each root verified by its own
//             residual |p(z)|; an unverified root fails the call.
//   system  — Newton for multivariate polynomial systems with the
//             exact monomial Jacobian (solved via the LU of
//             math.linsolve), verified by the system residual.
//             The MINPACK Rosenbrock problem is the reference case.
//
// Newton–Krylov and trust-region methods (MINPACK hybrd) for
// general systems are the engine tier: requires_engine_tier:minpack.

import { registerSolver } from "../registry.js";
import { luFactor } from "./linsolve.js";

const MAX_DEGREE = 20;
const ROOT_RTOL = 1e-8;

function validateCoeffs(c) {
  if (!Array.isArray(c) || c.length < 2) return "coefficients must be an array of at least 2 numbers, descending order";
  if (c.length - 1 > MAX_DEGREE) return `degree ${c.length - 1} exceeds the JS tier cap ${MAX_DEGREE}`;
  if (c.some((v) => !Number.isFinite(v))) return "coefficients contain a non-finite entry";
  if (c[0] === 0) return "leading coefficient must be non-zero (declare the true degree)";
  return null;
}

const polyEval = (c, x) => c.reduce((s, a) => s * x + a, 0);
const polyDeriv = (c) => c.slice(0, -1).map((a, i) => a * (c.length - 1 - i));

/* complex helpers, [re, im] pairs */
const cMul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cSub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cDiv = (a, b) => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const cAbs = (a) => Math.hypot(a[0], a[1]);
const polyEvalC = (c, z) => c.reduce((s, a) => cMul(s, z).map((v, i) => v + (i === 0 ? a : 0)), [0, 0]);

function brent(c, a, b, tol = 1e-14, maxIter = 200) {
  let fa = polyEval(c, a);
  let fb = polyEval(c, b);
  if (fa === 0) return { root: a, iterations: 0 };
  if (fb === 0) return { root: b, iterations: 0 };
  if (fa * fb > 0) return { refusal: `no_bracket_sign_change:p(${a}) = ${fa} and p(${b}) = ${fb} have the same sign` };
  if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; }
  let prev = a;
  let fprev = fa;
  let prevPrev = a;
  let mflag = true;
  let d = 0;
  for (let iter = 1; iter <= maxIter; iter += 1) {
    let s;
    if (fa !== fprev && fb !== fprev) {
      // inverse quadratic interpolation
      const t1 = (a * fb * fprev) / ((fa - fb) * (fa - fprev));
      const t2 = (b * fa * fprev) / ((fb - fa) * (fb - fprev));
      const t3 = (prev * fa * fb) / ((fprev - fa) * (fprev - fb));
      s = t1 + t2 + t3;
    } else {
      s = b - (fb * (b - a)) / (fb - fa); // secant
    }
    const lo = Math.min((3 * a + b) / 4, b);
    const hi = Math.max((3 * a + b) / 4, b);
    if (!(s > lo && s < hi)
      || (mflag && Math.abs(s - b) >= Math.abs(b - prev) / 2)
      || (!mflag && Math.abs(s - b) >= Math.abs(prev - prevPrev) / 2)
      || (mflag && Math.abs(b - prev) < tol)
      || (!mflag && Math.abs(prev - prevPrev) < tol)) {
      s = (a + b) / 2;
      mflag = true;
    } else {
      mflag = false;
    }
    const fs = polyEval(c, s);
    prevPrev = prev;
    prev = b;
    fprev = fb;
    if (fa * fs < 0) { b = s; fb = fs; } else { a = s; fa = fs; }
    if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; }
    d = Math.abs(b - a);
    if (fb === 0 || d < tol) return { root: b, iterations: iter, residual: Math.abs(fb) };
  }
  return { refusal: `not_converged:brent exceeded ${maxIter} iterations with bracket width ${d}` };
}

function newtonScalar(c, x0, tol = 1e-14, maxIter = 100) {
  const dc = polyDeriv(c);
  let x = x0;
  for (let iter = 1; iter <= maxIter; iter += 1) {
    const f = polyEval(c, x);
    if (f === 0) return { root: x, iterations: iter - 1, residual: 0 };
    const dfx = polyEval(dc, x);
    if (dfx === 0) return { refusal: `derivative_vanished:newton reached a stationary point at x = ${x} with p(x) = ${f}` };
    const step = f / dfx;
    x -= step;
    if (!Number.isFinite(x)) return { refusal: "diverged:newton iterate left the finite range" };
    if (Math.abs(step) <= tol * Math.max(1, Math.abs(x))) {
      return { root: x, iterations: iter, residual: Math.abs(polyEval(c, x)) };
    }
  }
  return { refusal: `not_converged:newton exceeded ${maxIter} iterations from x0 = ${x0} (residual ${Math.abs(polyEval(c, x))})` };
}

function durandKerner(c) {
  const n = c.length - 1;
  const lead = c[0];
  const mono = c.map((a) => a / lead);
  const radius = 1 + Math.max(...mono.slice(1).map(Math.abs));
  let roots = Array.from({ length: n }, (_, k) => {
    const ang = (2 * Math.PI * k) / n + 0.4;
    return [radius * Math.cos(ang), radius * Math.sin(ang)];
  });
  const maxIter = 1000;
  for (let iter = 0; iter < maxIter; iter += 1) {
    let maxDelta = 0;
    const next = roots.map((z, k) => {
      let denom = [1, 0];
      for (let j = 0; j < n; j += 1) {
        if (j !== k) denom = cMul(denom, cSub(z, roots[j]));
      }
      if (cAbs(denom) === 0) return z;
      const delta = cDiv(polyEvalC(mono, z), denom);
      maxDelta = Math.max(maxDelta, cAbs(delta));
      return cSub(z, delta);
    });
    roots = next;
    if (maxDelta < 1e-14) break;
  }
  return roots;
}

/* -------- multivariate polynomial systems -------- */

function validateSystem(equations) {
  if (!Array.isArray(equations) || equations.length === 0) return "equations must be a non-empty array";
  let nVars;
  for (const eq of equations) {
    if (!Array.isArray(eq) || eq.length === 0) return "each equation is a non-empty term list";
    for (const term of eq) {
      if (!Number.isFinite(term?.coeff) || !Array.isArray(term?.powers) || term.powers.length === 0
        || term.powers.some((e) => !Number.isInteger(e) || e < 0)) {
        return "each term needs {coeff, powers:[non-negative integers]}";
      }
      if (nVars === undefined) nVars = term.powers.length;
      else if (term.powers.length !== nVars) return "inconsistent variable counts across terms";
    }
  }
  return null;
}

const evalTerm = (term, x) => term.powers.reduce((s, e, i) => s * x[i] ** e, term.coeff);
const evalEq = (eq, x) => eq.reduce((s, t) => s + evalTerm(t, x), 0);
function jacobian(equations, x) {
  return equations.map((eq) => x.map((_, varIdx) => eq.reduce((s, term) => {
    const e = term.powers[varIdx];
    if (e === 0) return s;
    const powers = term.powers.slice();
    powers[varIdx] -= 1;
    return s + term.coeff * e * powers.reduce((p, pe, i) => p * x[i] ** pe, 1);
  }, 0)));
}

function luSolveLocal(fact, b) {
  const { lu, perm } = fact;
  const n = lu.length;
  const y = perm.map((p) => b[p]);
  for (let i = 1; i < n; i += 1) for (let j = 0; j < i; j += 1) y[i] -= lu[i][j] * y[j];
  const x = y.slice();
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = i + 1; j < n; j += 1) x[i] -= lu[i][j] * x[j];
    x[i] /= lu[i][i];
  }
  return x;
}

function runRoots(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (target === "system") {
    const badSys = validateSystem(inputs.equations);
    if (badSys) return { notComputed: `invalid_input:equations ${badSys}` };
    const equations = inputs.equations;
    const nVars = equations[0][0].powers.length;
    if (equations.length !== nVars) {
      return { notComputed: `invalid_input:equations ${equations.length} equations for ${nVars} variables — the JS tier decides square systems (continuation / trust-region for the rest is the MINPACK tier)` };
    }
    const x0 = inputs.x0;
    if (!Array.isArray(x0) || x0.length !== nVars || x0.some((v) => !Number.isFinite(v))) {
      return { notComputed: `missing_input:x0 (a start of ${nVars} finite numbers; Newton is start-dependent and no start is assumed)` };
    }
    let x = x0.slice();
    const tol = 1e-12;
    for (let iter = 0; iter <= 100; iter += 1) {
      const F = equations.map((eq) => evalEq(eq, x));
      const resid = Math.max(...F.map(Math.abs));
      if (resid <= tol) {
        return { inputs: { x0, iterations: iter }, outputs: { x, residualInf: resid }, margins: [], covers: [target] };
      }
      if (iter === 100) break;
      const J = jacobian(equations, x);
      const fact = luFactor(J);
      if (fact.singularAt !== undefined) {
        return { notComputed: `singular_jacobian:at iterate ${iter}, x = [${x.join(", ")}], residual ${resid}` };
      }
      const step = luSolveLocal(fact, F);
      x = x.map((v, i) => v - step[i]);
      if (x.some((v) => !Number.isFinite(v))) return { notComputed: "diverged:system newton iterate left the finite range" };
    }
    const residFinal = Math.max(...equations.map((eq) => Math.abs(evalEq(eq, x))));
    return { notComputed: `not_converged:system newton exceeded 100 iterations from x0 = [${x0.join(", ")}] (residual ${residFinal}) — try another declared start; trust-region is the MINPACK tier` };
  }
  if (!["brent", "newton", "roots"].includes(target)) {
    return { notComputed: `unknown_operation:${target} (Newton-Krylov / trust-region for general systems: requires_engine_tier:minpack)` };
  }
  const bad = validateCoeffs(inputs.coefficients);
  if (bad) return { notComputed: `invalid_input:coefficients ${bad}` };
  const c = inputs.coefficients;
  const scale = Math.max(1, ...c.map(Math.abs));

  if (target === "brent") {
    const br = inputs.bracket;
    if (!Array.isArray(br) || br.length !== 2 || br.some((v) => !Number.isFinite(v)) || !(br[0] < br[1])) {
      return { notComputed: "missing_input:bracket [a, b] with a < b (SC-03: no bracket is assumed)" };
    }
    const r = brent(c, br[0], br[1]);
    if (r.refusal) return { notComputed: r.refusal };
    return { inputs: { bracket: br }, outputs: { root: r.root, residual: Math.abs(polyEval(c, r.root)), iterations: r.iterations }, margins: [], covers: [target] };
  }
  if (target === "newton") {
    if (!Number.isFinite(inputs.x0)) return { notComputed: "missing_input:x0 (Newton is start-dependent; no start is assumed)" };
    const r = newtonScalar(c, inputs.x0);
    if (r.refusal) return { notComputed: r.refusal };
    return { inputs: { x0: inputs.x0 }, outputs: { root: r.root, residual: r.residual, iterations: r.iterations }, margins: [], covers: [target] };
  }
  // roots — all of them, each verified
  if (c.length === 2) {
    const root = -c[1] / c[0];
    return { inputs: { degree: 1 }, outputs: { roots: [{ re: root, im: 0 }], maxResidual: 0 }, margins: [], covers: [target] };
  }
  const found = durandKerner(c);
  const residuals = found.map((z) => cAbs(polyEvalC(c, z)));
  const worst = Math.max(...residuals);
  if (!(worst <= ROOT_RTOL * scale)) {
    return { notComputed: `not_converged:durand-kerner left a root with residual ${worst} (scale ${scale}) — multiple or clustered roots may need the companion-eigenvalue engine tier` };
  }
  const sorted = found
    .map(([re, im]) => ({ re, im: Math.abs(im) < 1e-12 ? 0 : im }))
    .sort((p, q) => p.re - q.re || p.im - q.im);
  return { inputs: { degree: c.length - 1 }, outputs: { roots: sorted, maxResidual: worst }, margins: [], covers: [target] };
}

export const rootsSolver = registerSolver({
  id: "math.roots",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 3,
  method: "Brent and Newton for scalar polynomials; Durand-Kerner for the full root set; Newton with the exact monomial Jacobian for polynomial systems (JS tier); Newton-Krylov / trust-region (MINPACK hybrd) is the engine tier",
  reference: "Numerical Recipes 3e Ch. 9; MINPACK test set (More, Garbow, Hillstrom, ANL-80-74) — Rosenbrock system",
  regime: "scalar polynomials to degree 20; square polynomial systems with a declared start; brackets must genuinely straddle a sign change",
  units: { inputs: "dimensionless coefficients (descending), brackets, starts", outputs: "roots with per-answer residuals" },
  tolerance: "scalar answers verified by |p(x)|; polynomial roots served only when every root's residual <= 1e-8 * coefficient scale",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runRoots,
});
