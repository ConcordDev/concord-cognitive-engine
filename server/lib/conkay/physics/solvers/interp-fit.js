// server/lib/conkay/physics/solvers/interp-fit.js
//
// math.interp-fit — SX-NUM-13 (ConKay solver catalogue, Wave 0).
//
// Interpolation and fitting at the JS tier. The catalogue's
// validity envelope is INSIDE THE DATA HULL: every evaluation
// target checks its points against the hull and refuses outside
// it by name — nothing here extrapolates quietly.
//
//   spline     cubic spline, natural or clamped boundary
//              conditions. The catalogue reference case is the
//              clamped form: with the cubic's own end
//              derivatives supplied, the spline reproduces the
//              cubic exactly (uniqueness of the clamped spline).
//   pchip      Fritsch-Carlson monotone cubic: the interpolant
//              preserves the data's monotonicity; the result
//              reports the measured monotonicity violation on a
//              fine sample (zero by construction).
//   chebyshev  Chebyshev-Lobatto interpolation of a function
//              (expression) on an interval, barycentric
//              evaluation; the result carries a sampled max-
//              error certificate against the function itself.
//   rbf        scattered-data interpolation (Gaussian or
//              multiquadric) in 1D/2D; the interpolation system
//              is residual-verified after the solve.
//   fit        polynomial least squares via math.svd-lsq; a
//              degree >= the point count is refused — that is
//              interpolation wearing a fit's clothes.
//
// Data discipline: x values must be strictly increasing for
// the 1D table targets; duplicate or unsorted abscissae are
// refused by name, never silently sorted or merged.

import { registerSolver } from "../registry.js";
import { parse, evaluateAst } from "./math-symbolic.js";
import { luFactor } from "./linsolve.js";
import { svd } from "./svd-lsq.js";

function luSolve(fact, b) {
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

function checkTable(inputs) {
  const { xs, ys } = inputs;
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 2) {
    return { refusal: "missing_input:xs and ys arrays of equal length >= 2" };
  }
  if (!xs.every(Number.isFinite) || !ys.every(Number.isFinite)) return { refusal: "invalid_input:xs and ys must be finite" };
  for (let i = 1; i < xs.length; i += 1) {
    if (!(xs[i] > xs[i - 1])) return { refusal: `invalid_input:xs must be strictly increasing (xs[${i}] <= xs[${i - 1}]); unsorted or duplicate abscissae are refused, never silently sorted` };
  }
  return { xs, ys };
}

function checkPoints(inputs, lo, hi) {
  const pts = inputs.points;
  if (!Array.isArray(pts) || pts.length === 0 || !pts.every(Number.isFinite)) {
    return { refusal: "missing_input:points (a non-empty array of finite evaluation points)" };
  }
  for (const p of pts) {
    if (p < lo || p > hi) return { refusal: `outside_data_hull:point ${p} lies outside [${lo}, ${hi}] — the validity envelope is inside the data hull; extrapolation is refused, not labelled` };
  }
  return { pts };
}

/* ---------------- cubic spline ---------------- */

function splineCoeffs(xs, ys, bc) {
  const n = xs.length - 1;
  const h = xs.map((x, i) => (i < n ? xs[i + 1] - x : 0));
  const A = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  const rhs = new Array(n + 1).fill(0);
  if (bc.type === "natural") {
    A[0][0] = 1;
    A[n][n] = 1;
  } else {
    A[0][0] = 2 * h[0];
    A[0][1] = h[0];
    rhs[0] = 3 * ((ys[1] - ys[0]) / h[0] - bc.da);
    A[n][n - 1] = h[n - 1];
    A[n][n] = 2 * h[n - 1];
    rhs[n] = 3 * (bc.db - (ys[n] - ys[n - 1]) / h[n - 1]);
  }
  for (let i = 1; i < n; i += 1) {
    A[i][i - 1] = h[i - 1];
    A[i][i] = 2 * (h[i - 1] + h[i]);
    A[i][i + 1] = h[i];
    rhs[i] = 3 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1]);
  }
  const fact = luFactor(A);
  if (fact.singularAt !== undefined) return { refusal: "singular_system:the spline system is singular" };
  const c = luSolve(fact, rhs); // c_i = S''(x_i)/2 in the standard form below
  const segs = [];
  for (let i = 0; i < n; i += 1) {
    const b = (ys[i + 1] - ys[i]) / h[i] - (h[i] * (2 * c[i] + c[i + 1])) / 3;
    const d = (c[i + 1] - c[i]) / (3 * h[i]);
    segs.push({ b, c: c[i], d });
  }
  return { segs };
}

const evalSegs = (xs, ys, segs, x) => {
  let i = xs.length - 2;
  while (i > 0 && xs[i] > x) i -= 1;
  const dx = x - xs[i];
  const s = segs[i];
  return ys[i] + s.b * dx + s.c * dx * dx + s.d * dx * dx * dx;
};

/* ---------------- PCHIP (Fritsch-Carlson) ---------------- */

function pchipSlopes(xs, ys) {
  const n = xs.length - 1;
  const h = [];
  const delta = [];
  for (let i = 0; i < n; i += 1) {
    h.push(xs[i + 1] - xs[i]);
    delta.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = new Array(n + 1);
  m[0] = delta[0];
  m[n] = delta[n - 1];
  for (let i = 1; i < n; i += 1) {
    if (delta[i - 1] * delta[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }
  // endpoint limiting (Fritsch-Carlson one-sided)
  const limitEnd = (mEnd, d0, d1) => {
    if (Math.sign(mEnd) !== Math.sign(d0)) return 0;
    if (Math.sign(d0) !== Math.sign(d1) && Math.abs(mEnd) > 3 * Math.abs(d0)) return 3 * d0;
    return mEnd;
  };
  m[0] = limitEnd(m[0], delta[0], delta[1] ?? delta[0]);
  m[n] = limitEnd(m[n], delta[n - 1], delta[n - 2] ?? delta[n - 1]);
  return m;
}

const evalHermite = (xs, ys, m, x) => {
  let i = xs.length - 2;
  while (i > 0 && xs[i] > x) i -= 1;
  const h = xs[i + 1] - xs[i];
  const t = (x - xs[i]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[i] + h * (t3 - 2 * t2 + t) * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + h * (t3 - t2) * m[i + 1];
};

/* ---------------- the solver ---------------- */

function runInterpFit(ctx, target) {
  const inputs = ctx?.inputs || {};

  if (target === "spline" || target === "pchip") {
    const tab = checkTable(inputs);
    if (tab.refusal) return { notComputed: tab.refusal };
    const cp = checkPoints(inputs, tab.xs[0], tab.xs[tab.xs.length - 1]);
    if (cp.refusal) return { notComputed: cp.refusal };
    if (target === "spline") {
      const bcIn = inputs.bc || { type: "natural" };
      if (bcIn.type !== "natural" && bcIn.type !== "clamped") return { notComputed: `invalid_input:bc.type must be natural or clamped` };
      if (bcIn.type === "clamped" && (!Number.isFinite(bcIn.da) || !Number.isFinite(bcIn.db))) {
        return { notComputed: "missing_input:bc.da and bc.db (the clamped end derivatives; SC-03: they are never guessed)" };
      }
      const built = splineCoeffs(tab.xs, tab.ys, bcIn);
      if (built.refusal) return { notComputed: built.refusal };
      return {
        inputs: { points: cp.pts.length, bc: bcIn.type },
        outputs: { values: cp.pts.map((p) => ({ x: p, y: evalSegs(tab.xs, tab.ys, built.segs, p) })) },
        margins: [],
        covers: [target],
      };
    }
    const m = pchipSlopes(tab.xs, tab.ys);
    // measured monotonicity violation on a fine sample, per segment
    let violation = 0;
    for (let i = 0; i < tab.xs.length - 1; i += 1) {
      let prev = evalHermite(tab.xs, tab.ys, m, tab.xs[i]);
      const dir = Math.sign(tab.ys[i + 1] - tab.ys[i]);
      for (let s = 1; s <= 20; s += 1) {
        const x = tab.xs[i] + ((tab.xs[i + 1] - tab.xs[i]) * s) / 20;
        const v = evalHermite(tab.xs, tab.ys, m, x);
        if (dir > 0) violation = Math.max(violation, prev - v);
        if (dir < 0) violation = Math.max(violation, v - prev);
        prev = v;
      }
    }
    return {
      inputs: { points: cp.pts.length },
      outputs: { values: cp.pts.map((p) => ({ x: p, y: evalHermite(tab.xs, tab.ys, m, p) })), monotonicityViolation: Math.max(0, violation) },
      margins: [],
      covers: [target],
    };
  }

  if (target === "chebyshev") {
    const { a, b } = inputs;
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return { notComputed: "missing_input:finite a and b with a != b" };
    if (typeof inputs.f !== "string" || !inputs.f.trim()) return { notComputed: "missing_input:f (an expression string; SC-03)" };
    let ast;
    try {
      ast = parse(inputs.f);
    } catch (err) {
      return { notComputed: `invalid_input:f ${err.message}` };
    }
    const n = Number.isInteger(inputs.degree) && inputs.degree >= 2 ? inputs.degree : 12;
    if (n > 64) return { notComputed: `degree_too_large:${n} exceeds the JS tier cap 64` };
    const mid = (a + b) / 2;
    const half = (b - a) / 2;
    const nodes = [];
    for (let k = 0; k <= n; k += 1) nodes.push(mid + half * Math.cos((Math.PI * k) / n));
    const vals = nodes.map((x) => evaluateAst(ast, { x }));
    const weights = nodes.map((_, k) => (k === 0 || k === n ? 0.5 : 1) * (k % 2 === 0 ? 1 : -1));
    const evalAt = (x) => {
      // barycentric formula for Chebyshev-Lobatto nodes
      let num = 0;
      let den = 0;
      for (let k = 0; k <= n; k += 1) {
        const diff = x - nodes[k];
        if (diff === 0) return vals[k];
        const w = weights[k] / diff;
        num += w * vals[k];
        den += w;
      }
      return num / den;
    };
    const cp = checkPoints(inputs, a, b);
    if (cp.refusal) return { notComputed: cp.refusal };
    let maxErr = 0;
    for (let s = 0; s <= 200; s += 1) {
      const x = a + ((b - a) * s) / 200;
      maxErr = Math.max(maxErr, Math.abs(evalAt(x) - evaluateAst(ast, { x })));
    }
    return {
      inputs: { a, b, degree: n },
      outputs: { values: cp.pts.map((p) => ({ x: p, y: evalAt(p) })), sampledMaxError: maxErr },
      margins: [],
      covers: [target],
    };
  }

  if (target === "rbf") {
    const ptsIn = inputs.pointsIn;
    const valsIn = inputs.values;
    if (!Array.isArray(ptsIn) || !Array.isArray(valsIn) || ptsIn.length !== valsIn.length || ptsIn.length < 2) {
      return { notComputed: "missing_input:pointsIn and values arrays of equal length >= 2" };
    }
    const dim = Array.isArray(ptsIn[0]) ? ptsIn[0].length : 1;
    if (dim !== 1 && dim !== 2) return { notComputed: `invalid_input:scattered points must be 1D or 2D (got dim ${dim})` };
    const P = ptsIn.map((p) => (Array.isArray(p) ? p : [p]));
    if (!P.every((p) => p.length === dim && p.every(Number.isFinite)) || !valsIn.every(Number.isFinite)) {
      return { notComputed: "invalid_input:pointsIn and values must be finite and uniformly dimensioned" };
    }
    const kernel = inputs.kernel === undefined ? "gaussian" : inputs.kernel;
    if (!["gaussian", "multiquadric"].includes(kernel)) return { notComputed: `invalid_input:kernel must be gaussian or multiquadric` };
    const eps = inputs.shape === undefined ? 1 : inputs.shape;
    if (!(eps > 0)) return { notComputed: "invalid_input:shape must be positive" };
    const phi = (r) => (kernel === "gaussian" ? Math.exp(-((eps * r) ** 2)) : Math.sqrt(1 + (eps * r) ** 2));
    const dist = (p, q) => Math.hypot(...p.map((v, i) => v - q[i]));
    const n = P.length;
    if (n > 200) return { notComputed: `system_too_large:${n} centers exceeds the JS tier cap 200` };
    const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => phi(dist(P[i], P[j]))));
    const fact = luFactor(A);
    if (fact.singularAt !== undefined) return { notComputed: "singular_system:the RBF system is singular (duplicate centers or a degenerate shape parameter)" };
    const w = luSolve(fact, valsIn.slice());
    let residual = 0;
    for (let i = 0; i < n; i += 1) {
      let s = 0;
      for (let j = 0; j < n; j += 1) s += A[i][j] * w[j];
      residual = Math.max(residual, Math.abs(s - valsIn[i]));
    }
    if (residual > 1e-6) return { notComputed: `verification_failed:RBF interpolation residual ${residual} — the system is too ill-conditioned to certify` };
    const evalPts = inputs.points;
    if (!Array.isArray(evalPts) || evalPts.length === 0) return { notComputed: "missing_input:points (evaluation points)" };
    const E = evalPts.map((p) => (Array.isArray(p) ? p : [p]));
    const lo = P.map((_, d) => Math.min(...P.map((p) => p[d])));
    const hi = P.map((_, d) => Math.max(...P.map((p) => p[d])));
    for (const p of E) {
      for (let d = 0; d < dim; d += 1) {
        if (!(p[d] >= lo[d] && p[d] <= hi[d])) return { notComputed: `outside_data_hull:evaluation point [${p}] lies outside the data bounding box — refused, not extrapolated` };
      }
    }
    return {
      inputs: { kernel, shape: eps, centers: n },
      outputs: { values: E.map((p) => ({ point: p, y: w.reduce((s, wj, j) => s + wj * phi(dist(p, P[j])), 0) })), interpolationResidual: residual },
      margins: [],
      covers: [target],
    };
  }

  if (target === "fit") {
    const tab = checkTable(inputs);
    if (tab.refusal) return { notComputed: tab.refusal };
    const degree = inputs.degree;
    if (!Number.isInteger(degree) || degree < 0) return { notComputed: "missing_input:degree (a non-negative integer)" };
    if (degree >= tab.xs.length) {
      return { notComputed: `invalid_input:degree ${degree} >= ${tab.xs.length} points — that is interpolation, not a fit; a fit must leave residual degrees of freedom` };
    }
    const A = tab.xs.map((x) => Array.from({ length: degree + 1 }, (_, k) => x ** k));
    const { U, s, Vt } = svd(A);
    void U;
    void Vt;
    // least squares via the SVD solver's own path: reuse its lsq
    // by solving the normal equations in SVD form here
    const k = s.length;
    const Utb = new Array(k).fill(0);
    for (let i = 0; i < k; i += 1) {
      let sum = 0;
      for (let row = 0; row < A.length; row += 1) sum += U[row][i] * tab.ys[row];
      Utb[i] = sum;
    }
    const coeffs = new Array(degree + 1).fill(0);
    const rcond = 1e-12;
    for (let i = 0; i < k; i += 1) {
      if (s[i] > rcond * s[0]) {
        for (let j = 0; j < degree + 1; j += 1) coeffs[j] += (Utb[i] / s[i]) * Vt[i][j];
      }
    }
    let rss = 0;
    let tss = 0;
    const mean = tab.ys.reduce((a2, v) => a2 + v, 0) / tab.ys.length;
    for (let i = 0; i < tab.xs.length; i += 1) {
      const pred = coeffs.reduce((sum, c, p) => sum + c * tab.xs[i] ** p, 0);
      rss += (tab.ys[i] - pred) ** 2;
      tss += (tab.ys[i] - mean) ** 2;
    }
    return {
      inputs: { degree, points: tab.xs.length },
      outputs: { coefficients: coeffs, rmsResidual: Math.sqrt(rss / tab.xs.length), rSquared: tss > 0 ? 1 - rss / tss : 1 },
      margins: [],
      covers: [target],
    };
  }

  return { notComputed: `unknown_operation:${target}` };
}

export const interpFit = registerSolver({
  id: "math.interp-fit",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 2,
  method: "cubic splines (natural/clamped), Fritsch-Carlson PCHIP, Chebyshev-Lobatto barycentric interpolation, Gaussian/multiquadric RBF for scattered data, polynomial least squares via the SVD solver",
  reference: "closed-form self-checks per the catalogue row: the clamped spline reproduces a cubic exactly; PCHIP preserves monotonicity by construction (measured and reported)",
  regime: "validity envelope is INSIDE THE DATA HULL — evaluation outside it is refused by name on every target; strictly increasing abscissae required; fit degree must leave residual degrees of freedom",
  units: { inputs: "tables {xs, ys} + points, or a function expression + interval (chebyshev), or scattered {pointsIn, values} (rbf)", outputs: "values at the requested points with the target's certificate (sampled error / monotonicity violation / residual / RMS + R^2)" },
  tolerance: "certificates are reported per call; RBF interpolation residual must be <= 1e-6 to serve",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runInterpFit,
});
