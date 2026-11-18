// server/lib/conkay/physics/solvers/bvp.js
//
// math.bvp — SX-NUM-09 (ConKay solver catalogue, Wave 0).
//
// Two-point boundary-value problems at the JS tier.
//
//   solve   — finite-difference collocation for systems
//             y' = F(x, y) with boundary residuals as DATA:
//             bcLeft / bcRight are expression lists over the
//             state at each end (their values must vanish).
//             The discretization is the implicit midpoint rule
//             on a uniform mesh (order 2); the collocation
//             system is solved by damped Newton over a
//             finite-difference Jacobian. The answer ships with
//             a mesh-doubling error estimate: the difference
//             between the N and 2N solutions is reported, and if
//             it exceeds the declared tolerance the call is
//             NOT_COMPUTED — a coarse answer is never dressed as
//             a converged one.
//   blasius — the catalogue's reference problem, decided by
//             shooting: f''' + (1/2) f f'' = 0, f(0) = f'(0) = 0,
//             f'(etaMax) = 1, integrated by RK4 with the missing
//             initial curvature f''(0) found by secant iteration.
//             etaMax is declared (default 10), never hidden.
//
// Spectral (Chebyshev) collocation is a named follow-on scope.

import { registerSolver } from "../registry.js";
import { parse, evaluateAst } from "./math-symbolic.js";
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

function compileExprs(list, what) {
  if (!Array.isArray(list) || list.some((s) => typeof s !== "string")) {
    return { refusal: `invalid_input:${what} must be a list of expression strings` };
  }
  try {
    return { asts: list.map((s) => parse(s)) };
  } catch (err) {
    return { refusal: `invalid_input:${what} ${err.message}` };
  }
}

const evalExprs = (asts, env) => asts.map((ast) => {
  const v = evaluateAst(ast, env);
  if (!Number.isFinite(v)) throw new Error("expression evaluation is not finite");
  return v;
});

function collocationSolve(F, bcL, bcR, a, b, n, N, guess) {
  // unknowns: Y[(N+1) x n], row-major by node
  const h = (b - a) / N;
  const dim = (N + 1) * n;
  const residual = (Y) => {
    const R = new Array(dim);
    const at = (i) => Y.slice(i * n, (i + 1) * n);
    const envOf = (x, y) => {
      const e = { x };
      y.forEach((v, j) => { e[`y${j}`] = v; });
      return e;
    };
    // boundary residuals occupy the first and last n slots via
    // collocation on N intervals: layout = [bcL (nL), colloc ((N-1)*n + ... )]
    // Simpler standard layout: first nL rows bcLeft, then N*n
    // collocation rows, then nR rows bcRight, with nL + nR = n.
    let row = 0;
    for (const v of evalExprs(bcL, envOf(a, at(0)))) { R[row] = v; row += 1; }
    for (let i = 0; i < N; i += 1) {
      const y0 = at(i);
      const y1 = at(i + 1);
      const ym = y0.map((v, j) => 0.5 * (v + y1[j]));
      const fm = evalExprs(F, envOf(a + (i + 0.5) * h, ym));
      for (let j = 0; j < n; j += 1) { R[row] = y1[j] - y0[j] - h * fm[j]; row += 1; }
    }
    for (const v of evalExprs(bcR, envOf(b, at(N)))) { R[row] = v; row += 1; }
    return R;
  };
  let Y = guess.slice();
  let R = residual(Y);
  let norm = Math.max(...R.map(Math.abs));
  for (let iter = 0; iter < 25; iter += 1) {
    if (norm <= 1e-11) return { Y, residual: norm };
    const J = Array.from({ length: dim }, () => new Array(dim).fill(0));
    for (let j = 0; j < dim; j += 1) {
      const step = Math.sqrt(Number.EPSILON) * Math.max(1, Math.abs(Y[j]));
      const Yp = Y.slice();
      Yp[j] += step;
      const Rp = residual(Yp);
      for (let i = 0; i < dim; i += 1) J[i][j] = (Rp[i] - R[i]) / step;
    }
    const fact = luFactor(J);
    if (fact.singularAt !== undefined) return { refusal: `singular_collocation:the discretized system is singular at mesh ${N} (the BVP may have no solution or a non-isolated one at this mesh)` };
    const dY = luSolve(fact, R);
    // damped Newton: accept the largest step that reduces the norm
    let lambda = 1;
    let improved = false;
    while (lambda >= 1 / 16) {
      const Yt = Y.map((v, i) => v - lambda * dY[i]);
      const Rt = residual(Yt);
      const nt = Math.max(...Rt.map(Math.abs));
      if (nt < norm) { Y = Yt; R = Rt; norm = nt; improved = true; break; }
      lambda /= 2;
    }
    if (!improved) return { refusal: `not_converged:collocation newton stalled at residual ${norm} on mesh ${N}` };
  }
  return norm <= 1e-9 ? { Y, residual: norm } : { refusal: `not_converged:collocation residual ${norm} after 25 iterations on mesh ${N}` };
}

function runSolve(inputs) {
  const Fc = compileExprs(inputs.f, "f");
  if (Fc.refusal) return { notComputed: Fc.refusal };
  const n = Fc.asts.length;
  if (n === 0) return { notComputed: "missing_input:f (a non-empty list of expressions for y')" };
  const bcLc = compileExprs(inputs.bcLeft || [], "bcLeft");
  const bcRc = compileExprs(inputs.bcRight || [], "bcRight");
  if (bcLc.refusal) return { notComputed: bcLc.refusal };
  if (bcRc.refusal) return { notComputed: bcRc.refusal };
  if (bcLc.asts.length + bcRc.asts.length !== n) {
    return { notComputed: `invalid_input:boundary conditions ${bcLc.asts.length} + ${bcRc.asts.length} != ${n} state components (a two-point BVP needs exactly n residuals)` };
  }
  const { a, b } = inputs;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) {
    return { notComputed: "missing_input:finite a and b with a != b" };
  }
  const tol = inputs.tol === undefined ? 1e-6 : inputs.tol;
  if (!(tol > 0)) return { notComputed: "invalid_input:tol must be positive" };
  const N0 = Number.isInteger(inputs.mesh) && inputs.mesh >= 4 ? inputs.mesh : 32;
  const mkGuess = (N) => {
    const g = new Array((N + 1) * n).fill(0);
    if (Array.isArray(inputs.guess) && inputs.guess.length === n) {
      for (let i = 0; i <= N; i += 1) inputs.guess.forEach((v, j) => { g[i * n + j] = v; });
    }
    return g;
  };
  let coarse;
  let fine;
  try {
    coarse = collocationSolve(Fc.asts, bcLc.asts, bcRc.asts, a, b, n, N0, mkGuess(N0));
    if (coarse.refusal) return { notComputed: coarse.refusal };
    fine = collocationSolve(Fc.asts, bcLc.asts, bcRc.asts, a, b, n, 2 * N0, mkGuess(2 * N0));
    if (fine.refusal) return { notComputed: fine.refusal };
  } catch (err) {
    return { notComputed: `evaluation_failed:${err.message}` };
  }
  // mesh-doubling estimate at the shared nodes
  let estimate = 0;
  for (let i = 0; i <= N0; i += 1) {
    for (let j = 0; j < n; j += 1) {
      estimate = Math.max(estimate, Math.abs(fine.Y[(2 * i) * n + j] - coarse.Y[i * n + j]));
    }
  }
  if (estimate > tol) {
    return { notComputed: `not_converged:mesh-doubling estimate ${estimate} exceeds tol ${tol} (meshes ${N0} -> ${2 * N0}); raise the mesh or loosen tol — the coarse answer is not served` };
  }
  const N = 2 * N0;
  const h = (b - a) / N;
  const nodes = [];
  for (let i = 0; i <= N; i += 1) nodes.push({ x: a + i * h, y: fine.Y.slice(i * n, (i + 1) * n) });
  return {
    inputs: { a, b, tol, mesh: N },
    outputs: { nodes, meshErrorEstimate: estimate, collocationResidual: fine.residual },
    margins: [],
    covers: ["solve"],
  };
}

function runBlasius(inputs) {
  const etaMax = inputs.etaMax === undefined ? 10 : inputs.etaMax;
  if (!(etaMax >= 4 && etaMax <= 30)) return { notComputed: "invalid_input:etaMax must lie in [4, 30] (the truncated boundary f'(etaMax) = 1 is declared, not hidden)" };
  const steps = 4000;
  const h = etaMax / steps;
  const integrate = (s) => {
    // state [f, f', f'']; f''' = -0.5 f f''
    let st = [0, 0, s];
    const deriv = ([f, fp, fpp]) => [fp, fpp, -0.5 * f * fpp];
    const samples = [{ eta: 0, f: 0, fp: 0, fpp: s }];
    for (let i = 0; i < steps; i += 1) {
      const k1 = deriv(st);
      const k2 = deriv(st.map((v, j) => v + (h / 2) * k1[j]));
      const k3 = deriv(st.map((v, j) => v + (h / 2) * k2[j]));
      const k4 = deriv(st.map((v, j) => v + h * k3[j]));
      st = st.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
      if ((i + 1) % 400 === 0) samples.push({ eta: (i + 1) * h, f: st[0], fp: st[1], fpp: st[2] });
    }
    return { fpEnd: st[1], samples };
  };
  let s0 = 0.3;
  let s1 = 0.35;
  let F0 = integrate(s0).fpEnd - 1;
  let out = null;
  for (let iter = 0; iter < 30; iter += 1) {
    out = integrate(s1);
    const F1 = out.fpEnd - 1;
    if (Math.abs(F1) <= 1e-11) break;
    const sNext = s1 - (F1 * (s1 - s0)) / (F1 - F0);
    s0 = s1; F0 = F1; s1 = sNext;
    out = null;
  }
  const final = out || integrate(s1);
  if (Math.abs(final.fpEnd - 1) > 1e-9) {
    return { notComputed: `not_converged:shooting left f'(etaMax) - 1 = ${final.fpEnd - 1} after 30 secant iterations` };
  }
  return {
    inputs: { etaMax },
    outputs: { fpp0: s1, fpEnd: final.fpEnd, profile: final.samples },
    margins: [],
    covers: ["blasius"],
  };
}

function runBvp(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (target === "solve") return runSolve(inputs);
  if (target === "blasius") return runBlasius(inputs);
  return { notComputed: `unknown_operation:${target} (spectral Chebyshev collocation is a named follow-on scope)` };
}

export const bvp = registerSolver({
  id: "math.bvp",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 3,
  method: "finite-difference collocation (implicit midpoint, damped Newton, mesh-doubling error estimate) for two-point systems; shooting with RK4 + secant for the Blasius reference problem; Chebyshev spectral collocation is a named follow-on",
  reference: "Ascher, Mattheij & Russell, Numerical Solution of Boundary Value Problems for Ordinary Differential Equations — the Blasius problem, f''(0) = 0.332057...",
  regime: "two-point BVPs with exactly n boundary residuals for n state components; answers ship only when the mesh-doubling estimate meets the declared tolerance",
  units: { inputs: "f and boundary-residual expression lists over x, y*; interval; mesh; tol", outputs: "solution nodes with mesh error estimate and collocation residual; Blasius: f''(0) and the profile" },
  tolerance: "declared per call (default 1e-6) against the mesh-doubling estimate",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runBvp,
});
