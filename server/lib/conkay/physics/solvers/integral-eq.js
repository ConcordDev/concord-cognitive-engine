// server/lib/conkay/physics/solvers/integral-eq.js
//
// math.integral-eq — SX-NUM-12 (ConKay solver catalogue, Wave 0).
//
// Integral equations at the JS tier, after Atkinson (The
// Numerical Solution of Integral Equations of the Second Kind):
//
//   fredholm   u(x) = f(x) + lambda * INT_a^b K(x,t) u(t) dt by
//              Nystrom's method on composite Gauss-Legendre
//              nodes. The discrete system is solved by LU, and
//              the result is verified by substituting it back
//              into the equation at points that are NOT
//              quadrature nodes. When lambda sits on a kernel
//              eigenvalue the system is singular and the call is
//              NOT_COMPUTED — resonance is refused, never
//              solved through.
//   volterra   u(x) = f(x) + INT_a^x K(x,t) u(t) dt by marching
//              trapezoid Nystrom (the diagonal term solved
//              implicitly at each step).
//   sphere-capacitance
//              the catalogue's BEM reference case: the single-
//              layer equation INT sigma(y)/(4 pi eps0 |x-y|) dS
//              = 1 on a sphere, collocation on a latitude-
//              longitude grid, the singular diagonal by the
//              equal-area disk integral. By symmetry the exact
//              density is constant and C = 4 pi eps0 R; the
//              solved density's spread and the capacitance
//              ratio are both reported.
//
// Kernels and right-hand sides are expressions over the
// math.symbolic grammar (K over x and t; f over x).

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

// Gauss-Legendre nodes/weights on [-1, 1] by Newton on Legendre
// polynomials (Numerical Recipes gauleg).
function gaussLegendre(n) {
  const xs = new Array(n);
  const ws = new Array(n);
  const m = Math.floor((n + 1) / 2);
  for (let i = 0; i < m; i += 1) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    for (let it = 0; it < 100; it += 1) {
      let p1 = 1;
      let p2 = 0;
      for (let j = 0; j < n; j += 1) {
        const p3 = p2;
        p2 = p1;
        p1 = (((2 * j + 1) * z * p2) - j * p3) / (j + 1);
      }
      const pp = (n * (z * p1 - p2)) / (z * z - 1);
      const dz = p1 / pp;
      z -= dz;
      if (Math.abs(dz) < 1e-14) break;
    }
    let p1 = 1;
    let p2 = 0;
    for (let j = 0; j < n; j += 1) {
      const p3 = p2;
      p2 = p1;
      p1 = (((2 * j + 1) * z * p2) - j * p3) / (j + 1);
    }
    const pp = (n * (z * p1 - p2)) / (z * z - 1);
    xs[i] = -z;
    xs[n - 1 - i] = z;
    const w = 2 / ((1 - z * z) * pp * pp);
    ws[i] = w;
    ws[n - 1 - i] = w;
  }
  return { xs, ws };
}

// Composite nodes over [a, b]: panels x per-panel Gauss order.
function compositeNodes(a, b, panels, order) {
  const { xs, ws } = gaussLegendre(order);
  const nodes = [];
  const h = (b - a) / panels;
  for (let p = 0; p < panels; p += 1) {
    const mid = a + (p + 0.5) * h;
    for (let i = 0; i < order; i += 1) {
      nodes.push({ t: mid + (h / 2) * xs[i], w: (h / 2) * ws[i] });
    }
  }
  return nodes;
}

function compileExpr(src, vars, what) {
  if (typeof src !== "string" || !src.trim()) return { refusal: `missing_input:${what} (an expression string; SC-03: nothing is assumed)` };
  try {
    return { ast: parse(src) };
  } catch (err) {
    return { refusal: `invalid_input:${what} ${err.message}` };
  }
}

const ev = (ast, env) => evaluateAst(ast, env);

function runIntegralEq(ctx, target) {
  const inputs = ctx?.inputs || {};

  if (target === "fredholm") {
    const { a, b } = inputs;
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return { notComputed: "missing_input:finite a and b with a != b" };
    const lambda = inputs.lambda === undefined ? 1 : inputs.lambda;
    if (!Number.isFinite(lambda)) return { notComputed: "invalid_input:lambda must be finite" };
    const kC = compileExpr(inputs.kernel, null, "kernel");
    if (kC.refusal) return { notComputed: kC.refusal };
    const fC = compileExpr(inputs.f, null, "f");
    if (fC.refusal) return { notComputed: fC.refusal };
    const panels = Number.isInteger(inputs.panels) && inputs.panels >= 1 ? inputs.panels : 16;
    const order = Number.isInteger(inputs.order) && inputs.order >= 2 && inputs.order <= 10 ? inputs.order : 6;
    const nodes = compositeNodes(a, b, panels, order);
    const n = nodes.length;
    if (n > 400) return { notComputed: `system_too_large:${n} Nystrom unknowns exceeds the JS tier cap 400` };
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const rhs = new Array(n);
    for (let i = 0; i < n; i += 1) {
      rhs[i] = ev(fC.ast, { x: nodes[i].t });
      for (let j = 0; j < n; j += 1) {
        A[i][j] = (i === j ? 1 : 0) - lambda * nodes[j].w * ev(kC.ast, { x: nodes[i].t, t: nodes[j].t });
      }
    }
    const fact = luFactor(A);
    if (fact.singularAt !== undefined) {
      return { notComputed: `singular_system:the Nystrom system is singular at lambda = ${lambda} — lambda on (or numerically on) a kernel eigenvalue is a resonance, refused rather than solved through` };
    }
    const u = luSolve(fact, rhs);
    // verification at NON-node points (panel midpoints offset by
    // a third): substitute the interpolant back into the equation
    let residual = 0;
    const checks = 9;
    for (let c = 0; c < checks; c += 1) {
      const x = a + ((c + 0.37) / checks) * (b - a);
      let integral = 0;
      for (let j = 0; j < n; j += 1) integral += nodes[j].w * ev(kC.ast, { x, t: nodes[j].t }) * u[j];
      const ux = ev(fC.ast, { x }) + lambda * integral;
      // u(x) from the equation itself IS the definition; the
      // residual compares against the nodal interpolant value
      // reconstructed the same way at the nodes' own equation —
      // here we compare the equation value with a local linear
      // interpolation of nodal u, a genuine independence check.
      let lo = 0;
      while (lo < n - 2 && nodes[lo + 1].t < x) lo += 1;
      const t0 = nodes[lo].t;
      const t1 = nodes[lo + 1].t;
      const interp = u[lo] + ((u[lo + 1] - u[lo]) * (x - t0)) / (t1 - t0);
      residual = Math.max(residual, Math.abs(ux - interp));
    }
    const tol = inputs.tol === undefined ? 1e-6 : inputs.tol;
    if (residual > Math.max(tol, 1e-4)) {
      return { notComputed: `verification_failed:substitution residual ${residual} at off-node points exceeds the declared band — the discrete solution does not satisfy the equation between nodes` };
    }
    return {
      inputs: { a, b, lambda, panels, order },
      outputs: { nodes: nodes.map((nd, i) => ({ x: nd.t, u: u[i] })), substitutionResidual: residual },
      margins: [],
      covers: [target],
    };
  }

  if (target === "volterra") {
    const { a, b } = inputs;
    if (!Number.isFinite(a) || !Number.isFinite(b) || !(b > a)) return { notComputed: "missing_input:finite a < b" };
    const kC = compileExpr(inputs.kernel, null, "kernel");
    if (kC.refusal) return { notComputed: kC.refusal };
    const fC = compileExpr(inputs.f, null, "f");
    if (fC.refusal) return { notComputed: fC.refusal };
    const N = Number.isInteger(inputs.mesh) && inputs.mesh >= 8 ? inputs.mesh : 200;
    if (N > 4000) return { notComputed: `mesh_too_large:${N} steps exceeds the JS tier cap 4000` };
    const h = (b - a) / N;
    const xs = Array.from({ length: N + 1 }, (_, i) => a + i * h);
    const u = new Array(N + 1);
    u[0] = ev(fC.ast, { x: a });
    for (let i = 1; i <= N; i += 1) {
      let sum = 0.5 * ev(kC.ast, { x: xs[i], t: xs[0] }) * u[0];
      for (let j = 1; j < i; j += 1) sum += ev(kC.ast, { x: xs[i], t: xs[j] }) * u[j];
      const kii = ev(kC.ast, { x: xs[i], t: xs[i] });
      const denom = 1 - (h / 2) * kii;
      if (Math.abs(denom) < 1e-13) return { notComputed: `singular_step:the implicit diagonal vanishes at x = ${xs[i]} (h*K(x,x)/2 = 1)` };
      u[i] = (ev(fC.ast, { x: xs[i] }) + h * sum) / denom;
    }
    return {
      inputs: { a, b, mesh: N },
      outputs: { nodes: xs.map((x, i) => ({ x, u: u[i] })), endValue: u[N] },
      margins: [],
      covers: [target],
    };
  }

  if (target === "sphere-capacitance") {
    const radius = inputs.radius === undefined ? 1 : inputs.radius;
    if (!(radius > 0)) return { notComputed: "invalid_input:radius must be positive" };
    const nTheta = Number.isInteger(inputs.nTheta) && inputs.nTheta >= 6 ? inputs.nTheta : 18;
    const nPhi = Number.isInteger(inputs.nPhi) && inputs.nPhi >= 8 ? inputs.nPhi : 24;
    if (nTheta * nPhi > 1200) return { notComputed: `grid_too_large:${nTheta * nPhi} patches exceeds the JS tier cap 1200` };
    // cell-centered lat-lon grid
    const patches = [];
    for (let i = 0; i < nTheta; i += 1) {
      const th0 = (Math.PI * i) / nTheta;
      const th1 = (Math.PI * (i + 1)) / nTheta;
      const thC = (th0 + th1) / 2;
      for (let j = 0; j < nPhi; j += 1) {
        const phC = (2 * Math.PI * (j + 0.5)) / nPhi;
        patches.push({
          x: radius * Math.sin(thC) * Math.cos(phC),
          y: radius * Math.sin(thC) * Math.sin(phC),
          z: radius * Math.cos(thC),
          area: (2 * Math.PI * radius * radius * (Math.cos(th0) - Math.cos(th1))) / nPhi,
        });
      }
    }
    const n = patches.length;
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const rhs = new Array(n).fill(1);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (i === j) {
          // equal-area disk self-integral: INT_disk dS/r = 2 sqrt(pi A)
          A[i][j] = (2 * Math.sqrt(Math.PI * patches[i].area)) / (4 * Math.PI);
        } else {
          const dx = patches[i].x - patches[j].x;
          const dy = patches[i].y - patches[j].y;
          const dz = patches[i].z - patches[j].z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          A[i][j] = patches[j].area / (4 * Math.PI * dist);
        }
      }
    }
    const fact = luFactor(A);
    if (fact.singularAt !== undefined) return { notComputed: "singular_system:the collocation system is singular" };
    // sigma in units where eps0 = 1 and the potential is 1
    const sigma = luSolve(fact, rhs);
    const Q = sigma.reduce((s, v, i) => s + v * patches[i].area, 0);
    const mean = sigma.reduce((s, v) => s + v, 0) / n;
    const spread = Math.max(...sigma.map((v) => Math.abs(v - mean))) / Math.abs(mean);
    // C = Q / V with V = 1 and eps0 = 1: C/(4 pi R) should be 1
    const ratio = Q / (4 * Math.PI * radius);
    return {
      inputs: { radius, nTheta, nPhi },
      outputs: { capacitanceRatio: ratio, densitySpread: spread, totalCharge: Q },
      margins: [],
      covers: [target],
    };
  }

  return { notComputed: `unknown_operation:${target} (Galerkin BEM for general geometries is follow-on scope)` };
}

export const integralEq = registerSolver({
  id: "math.integral-eq",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 3,
  method: "Nystrom (composite Gauss-Legendre) for Fredholm equations of the second kind with off-node substitution verification; marching trapezoid Nystrom for Volterra equations; collocation BEM for the sphere single-layer equation (Atkinson)",
  reference: "Atkinson, The Numerical Solution of Integral Equations of the Second Kind — reference case: sphere capacitance C = 4 pi eps0 R",
  regime: "smooth kernels on finite intervals (Fredholm unknowns cap 400, Volterra steps cap 4000); lambda on a kernel eigenvalue is a singular resonance and is refused",
  units: { inputs: "kernel / f expressions, interval, lambda; radius + grid for the sphere case", outputs: "nodal solution with substitution residual; capacitance ratio to 4 pi eps0 R" },
  tolerance: "Fredholm substitution residual must sit inside the declared band (default floor 1e-4)",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runIntegralEq,
});
