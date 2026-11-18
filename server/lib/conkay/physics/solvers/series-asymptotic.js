// server/lib/conkay/physics/solvers/series-asymptotic.js
//
// math.series-asymptotic — SX-NUM-16 (ConKay solver catalogue,
// Wave 0).
//
// Series and asymptotics at the JS fast-path tier. The
// catalogue's envelope rule for this row: the radius of
// convergence is DECLARED with every series result, and an
// asymptotic result never claims more accuracy than its
// least term.
//
//   taylor      coefficients by exact symbolic differentiation
//               (math.symbolic), evaluated at the centre; the
//               result declares a radius estimate from the
//               coefficient ratios and the next-term scale at
//               each evaluation point.
//   pade        [m/n] Pade approximants from Taylor
//               coefficients (the catalogue reference case is
//               the Pade approximant of e^x), via the Toeplitz
//               system; coefficients and evaluations served.
//   asymptotic  named divergent expansions (Stirling for
//               log Gamma) summed to OPTIMAL TRUNCATION: the
//               least term is the shipped error scale, and
//               when that floor exceeds the declared tolerance
//               the call refuses by name — an asymptotic
//               series has a floor and this solver says it.
//   accelerate  Aitken Delta^2 and the Wynn epsilon algorithm
//               on a caller sequence, reported BESIDE the
//               unaccelerated last term, never instead of it.
//
// Perturbation problems are served by composition (the DAE /
// BVP solvers with the small parameter swept), named in the
// doc; Laurent series name the follow-on scope.

import { registerSolver } from "../registry.js";
import { parse, differentiate, evaluateAst } from "./math-symbolic.js";
import { luFactor } from "./linsolve.js";

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

function taylorCoeffs(ast, varName, a, order) {
  const coeffs = [];
  let current = ast;
  let fact = 1;
  for (let k = 0; k <= order; k += 1) {
    if (k > 0) fact *= k;
    coeffs.push(evaluateAst(current, { [varName]: a }) / fact);
    current = differentiate(current, varName);
  }
  return coeffs;
}

function radiusEstimate(coeffs) {
  // root-test estimate from the last coefficients, labelled
  let est = Infinity;
  for (let k = Math.max(1, coeffs.length - 4); k < coeffs.length; k += 1) {
    if (coeffs[k] !== 0) est = Math.min(est, Math.abs(coeffs[k]) ** (-1 / k));
  }
  return est;
}

const BERNOULLI_EVEN = [
  [2, 1 / 6], [4, -1 / 30], [6, 1 / 42], [8, -1 / 30],
  [10, 5 / 66], [12, -691 / 2730], [14, 7 / 6], [16, -3617 / 510],
];

function runSeries(ctx, target) {
  const inputs = ctx?.inputs || {};

  if (target === "taylor" || target === "pade") {
    if (typeof inputs.f !== "string" || !inputs.f.trim()) return { notComputed: "missing_input:f (an expression; SC-03)" };
    let ast;
    try {
      ast = parse(inputs.f);
    } catch (err) {
      return { notComputed: `invalid_input:f ${err.message}` };
    }
    const varName = inputs.variable || "x";
    const a = inputs.center === undefined ? 0 : inputs.center;
    if (!Number.isFinite(a)) return { notComputed: "missing_input:center (a finite expansion centre)" };
    const m = target === "taylor" ? (inputs.order === undefined ? 8 : inputs.order) : inputs.m;
    const n = target === "pade" ? inputs.n : undefined;
    if (target === "taylor" && (!Number.isInteger(m) || m < 0 || m > 30)) return { notComputed: "invalid_input:order must be an integer 0..30" };
    if (target === "pade" && (!Number.isInteger(m) || !Number.isInteger(n) || m < 0 || n < 0 || m + n > 30)) {
      return { notComputed: "missing_input:integer m and n with m + n <= 30" };
    }
    const order = target === "taylor" ? m : m + n;
    let coeffs;
    try {
      coeffs = taylorCoeffs(ast, varName, a, order);
    } catch (err) {
      return { notComputed: `evaluation_failed:${err.message} (the centre may sit on a singularity — a Taylor centre must be a regular point)` };
    }
    const radius = radiusEstimate(coeffs);
    const pts = inputs.points;
    if (target === "taylor") {
      const out = {
        coefficients: coeffs,
        center: a,
        radiusEstimate: radius,
        radiusBasis: "root-test estimate from the last coefficients — an estimate, labelled as such",
      };
      if (Array.isArray(pts)) {
        out.values = pts.map((x) => {
          let s = 0;
          let term = 1;
          const dx = x - a;
          for (let k = 0; k < coeffs.length; k += 1) {
            if (k > 0) term *= dx;
            s += coeffs[k] * term;
          }
          const nextTerm = coeffs.length > 0 ? Math.abs(coeffs[coeffs.length - 1] * dx ** (coeffs.length - 1)) : 0;
          return { x, y: s, insideDeclaredRadius: Math.abs(dx) < radius, lastTermScale: nextTerm };
        });
      }
      return { inputs: { order, center: a }, outputs: out, margins: [], covers: [target] };
    }
    // Pade [m/n]: denominator from the Toeplitz system
    // SUM_{j=1..n} c_{m+i-j} q_j = -c_{m+i}, i = 1..n (c_k = 0 for k < 0)
    const c = (k) => (k < 0 ? 0 : coeffs[k]);
    let q = [1];
    if (n > 0) {
      const A = [];
      const rhs = [];
      for (let i = 1; i <= n; i += 1) {
        A.push(Array.from({ length: n }, (_, j) => c(m + i - (j + 1))));
        rhs.push(-c(m + i));
      }
      const fact = luFactor(A);
      if (fact.singularAt !== undefined) return { notComputed: "singular_system:the Pade Toeplitz system is singular at this [m/n] — the approximant does not exist in this form" };
      q = [1, ...luSolve(fact, rhs)];
    }
    const p = Array.from({ length: m + 1 }, (_, k) =>
      Array.from({ length: Math.min(k, n) + 1 }, (_, j) => c(k - j) * q[j]).reduce((s, v) => s + v, 0));
    const out = { numerator: p, denominator: q, center: a, radiusEstimate: radius };
    if (Array.isArray(pts)) {
      out.values = pts.map((x) => {
        const dx = x - a;
        let num = 0;
        let den = 0;
        for (let k = p.length - 1; k >= 0; k -= 1) num = num * dx + p[k];
        for (let k = q.length - 1; k >= 0; k -= 1) den = den * dx + q[k];
        return { x, y: num / den, denominatorAtPoint: den };
      });
    }
    return { inputs: { m, n, center: a }, outputs: out, margins: [], covers: [target] };
  }

  if (target === "asymptotic") {
    if (inputs.name !== "log-gamma") return { notComputed: `unknown_operation:asymptotic name ${inputs.name} (seated expansions: log-gamma; further named expansions are follow-on scope)` };
    const pts = inputs.points;
    if (!Array.isArray(pts) || pts.length === 0 || !pts.every((v) => Number.isFinite(v) && v > 0)) {
      return { notComputed: "missing_input:points (positive evaluation points)" };
    }
    const tol = inputs.tol === undefined ? 1e-10 : inputs.tol;
    const values = [];
    for (const x of pts) {
      const base = (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI);
      const terms = BERNOULLI_EVEN.map(([k, B]) => B / (k * (k - 1) * x ** (k - 1)));
      // optimal truncation: sum while terms shrink
      let sum = base;
      let used = 0;
      let least = Infinity;
      for (let i = 0; i < terms.length; i += 1) {
        if (i > 0 && Math.abs(terms[i]) >= Math.abs(terms[i - 1])) break;
        sum += terms[i];
        used += 1;
        least = Math.abs(terms[i]);
      }
      if (least > tol) {
        return { notComputed: `asymptotic_floor:at x = ${x} the Stirling series' least term is ${least} — coarser than the declared tolerance ${tol}; the expansion cannot certify this point and says so instead of serving a number` };
      }
      values.push({ x, y: sum, termsUsed: used, errorScale: least });
    }
    return { inputs: { name: "log-gamma", tol }, outputs: { values }, margins: [], covers: [target] };
  }

  if (target === "accelerate") {
    const seq = inputs.sequence;
    if (!Array.isArray(seq) || seq.length < 3 || !seq.every(Number.isFinite)) {
      return { notComputed: "missing_input:sequence (at least 3 finite partial sums)" };
    }
    // Aitken Delta^2 on the last triple
    const [s0, s1, s2] = seq.slice(-3);
    const denom = s2 - 2 * s1 + s0;
    const aitken = denom === 0 ? s2 : s2 - ((s2 - s1) ** 2) / denom;
    // Wynn epsilon table: E[i][k + 1] holds eps^(i)_k, with
    // eps^(i)_{-1} = 0 (column 0) and eps^(i)_0 = seq[i]
    // (column 1); eps^(i)_k = eps^(i+1)_{k-2} +
    // 1 / (eps^(i+1)_{k-1} - eps^(i)_{k-1}). The estimate is
    // the deepest even-order entry on the last diagonal.
    const N = seq.length;
    const E = Array.from({ length: N }, () => new Array(N + 1).fill(0));
    for (let i = 0; i < N; i += 1) E[i][1] = seq[i];
    let wynn = seq[N - 1];
    for (let k = 1; k <= N - 1; k += 1) {
      for (let i = 0; i + k < N; i += 1) {
        const diff = E[i + 1][k] - E[i][k];
        E[i][k + 1] = E[i + 1][k - 1] + (diff === 0 ? 0 : 1 / diff);
      }
      if (k % 2 === 0) wynn = E[N - 1 - k][k + 1];
    }
    return {
      inputs: { terms: N },
      outputs: { rawLastTerm: seq[N - 1], aitken, wynnEpsilon: wynn },
      margins: [],
      covers: [target],
    };
  }

  return { notComputed: `unknown_operation:${target} (Laurent series: follow-on scope)` };
}

export const seriesAsymptotic = registerSolver({
  id: "math.series-asymptotic",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 0,
  method: "Taylor coefficients by exact symbolic differentiation, Pade approximants via the Toeplitz system, Stirling asymptotics at optimal truncation with the least term as the error scale, Aitken and Wynn-epsilon sequence acceleration",
  reference: "DLMF — reference case: the Pade approximant of e^x; Stirling coefficients from the Bernoulli numbers (DLMF 5.11)",
  regime: "radius of convergence declared with every series result (root-test estimate, labelled); asymptotic results carry their least-term floor and refuse when the floor exceeds the declared tolerance",
  units: { inputs: "an expression + centre + order (taylor / pade), a named expansion + points (asymptotic), or a partial-sum sequence (accelerate)", outputs: "coefficients / approximant values / accelerated estimates, each with its declared validity scale" },
  tolerance: "declared per call for asymptotics; Taylor and Pade serve coefficients exactly as differentiated",
  screening: true,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runSeries,
});
