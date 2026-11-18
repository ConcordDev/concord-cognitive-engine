// server/lib/conkay/physics/solvers/verify-mms.js
//
// verify.mms — SX-XC-05 (ConKay solver catalogue, Wave 0).
//
// The method of manufactured solutions (MMS) at the JS tier,
// per the CB-0820 engine-only interim ruling: choose an exact
// solution, derive the source term that manufactures it, run
// the discretization on a mesh sequence, and MEASURE the
// observed order of accuracy against the theoretical order.
// The built-in library's source terms are hand-derived and
// pinned below. The general tier — arbitrary manufactured
// solutions, whose source terms must be derived symbolically
// (SXE-02), and per-engine MMS — refuses by name:
// requires_engine_tier:sxe-02.
//
// The verdict discipline: the measurement is the product.
// Errors and observed orders are served as measured; when an
// observed order falls outside its declared band around the
// theoretical order, or the errors are not monotone, the
// result carries a warning naming it (envelope WARN) — a
// failing order is a finding about the code under test,
// reported, never massaged.
//
// Catalogue reference case (Roache; Salari & Knupp,
// SAND2000-1444): Poisson MMS observed order 2.

import { registerSolver } from "../registry.js";

/* ---------------- manufactured library ---------------- */
/* Each entry: exact solution u, its source f = -Lap(u) (1D: -u''),
 * and gradients where the H1 error is measured (2D). */

const LIBRARY = {
  "poisson-1d": {
    kind: "1d",
    theory: { l2: 2 },
    band: 0.35,
    defaultMeshes: [40, 80, 160],
    maxMesh: 640,
    solutions: {
      sin: { u: (x) => Math.sin(Math.PI * x), f: (x) => Math.PI ** 2 * Math.sin(Math.PI * x) },
      poly: { u: (x) => x * x * (1 - x) * (1 - x), f: (x) => -2 + 12 * x - 12 * x * x },
    },
  },
  "poisson-2d": {
    kind: "2d",
    theory: { l2: 2, h1: 1 },
    band: 0.35,
    defaultMeshes: [8, 16, 32],
    maxMesh: 48,
    solutions: {
      "sin-product": {
        u: (x, y) => Math.sin(Math.PI * x) * Math.sin(Math.PI * y),
        f: (x, y) => 2 * Math.PI ** 2 * Math.sin(Math.PI * x) * Math.sin(Math.PI * y),
        grad: (x, y) => [Math.PI * Math.cos(Math.PI * x) * Math.sin(Math.PI * y), Math.PI * Math.sin(Math.PI * x) * Math.cos(Math.PI * y)],
      },
      poly: {
        u: (x, y) => x * (1 - x) * y * (1 - y),
        f: (x, y) => 2 * (y * (1 - y) + x * (1 - x)),
        grad: (x, y) => [(1 - 2 * x) * y * (1 - y), x * (1 - x) * (1 - 2 * y)],
      },
    },
  },
};

/* ---------------- 1D FD solve (Thomas) ---------------- */

function solvePoisson1D(sol, n) {
  const h = 1 / n;
  const m = n - 1; // interior unknowns
  const a = new Array(m).fill(-1); // sub
  const b = new Array(m).fill(2); // diag
  const c = new Array(m).fill(-1); // super
  const d = Array.from({ length: m }, (_, i) => h * h * sol.f((i + 1) * h));
  // Thomas algorithm
  const cp = new Array(m);
  const dp = new Array(m);
  cp[0] = c[0] / b[0]; dp[0] = d[0] / b[0];
  for (let i = 1; i < m; i += 1) {
    const den = b[i] - a[i] * cp[i - 1];
    cp[i] = i < m - 1 ? c[i] / den : 0;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / den;
  }
  const uh = new Array(n + 1).fill(0);
  uh[n - 1] = dp[m - 1];
  for (let i = m - 2; i >= 0; i -= 1) uh[i + 1] = dp[i] - cp[i] * uh[i + 2];
  let maxErr = 0;
  let l2 = 0;
  for (let i = 0; i <= n; i += 1) {
    const e = uh[i] - sol.u(i * h);
    maxErr = Math.max(maxErr, Math.abs(e));
    l2 += e * e;
  }
  return { h, maxError: maxErr, l2Error: Math.sqrt(h * l2) };
}

/* ---------------- 2D P1 FEM solve (CG) ---------------- */

function solvePoisson2D(sol, n) {
  const N = n + 1; // nodes per side
  const idx = (i, j) => j * N + i;
  const nodes = N * N;
  const coord = (k) => [k % N, Math.floor(k / N)];
  // sparse stiffness in Map-of-Maps + load vector
  const K = new Map();
  const F = new Array(nodes).fill(0);
  const addK = (r, c, v) => {
    if (!K.has(r)) K.set(r, new Map());
    K.get(r).set(c, (K.get(r).get(c) || 0) + v);
  };
  const h = 1 / n;
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) {
    const tris = [
      [idx(i, j), idx(i + 1, j), idx(i, j + 1)],
      [idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)],
    ];
    for (const tri of tris) {
      const pts = tri.map((k) => { const [a, b] = coord(k); return [a * h, b * h]; });
      const [[ax, ay], [bx, by], [cx, cy]] = pts;
      const area2 = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      const area = Math.abs(area2) / 2;
      const bvec = [by - cy, cy - ay, ay - by];
      const cvec = [cx - bx, ax - cx, bx - ax];
      for (let p = 0; p < 3; p += 1) for (let q = 0; q < 3; q += 1) {
        addK(tri[p], tri[q], (bvec[p] * bvec[q] + cvec[p] * cvec[q]) / (4 * area));
      }
      // load: 3-point edge-midpoint quadrature (exact for quadratics);
      // phi_p is 1/2 at the two edge midpoints touching p, 0 at the third
      const mids = [[(ax + bx) / 2, (ay + by) / 2], [(bx + cx) / 2, (by + cy) / 2], [(cx + ax) / 2, (cy + ay) / 2]];
      const fm = mids.map(([mx, my]) => sol.f(mx, my));
      F[tri[0]] += (area / 6) * (fm[0] + fm[2]);
      F[tri[1]] += (area / 6) * (fm[0] + fm[1]);
      F[tri[2]] += (area / 6) * (fm[1] + fm[2]);
    }
  }
  // boundary: u = 0 — solve the interior system
  const interior = [];
  const pos = new Map();
  for (let j = 1; j < n; j += 1) for (let i = 1; i < n; i += 1) { pos.set(idx(i, j), interior.length); interior.push(idx(i, j)); }
  const m = interior.length;
  const A = interior.map((r) => {
    const row = new Map();
    for (const [c, v] of K.get(r) || []) if (pos.has(c)) row.set(pos.get(c), v);
    return row;
  });
  const rhs = interior.map((r) => F[r]);
  // CG with Jacobi preconditioner
  const x = new Array(m).fill(0);
  const diag = A.map((row, i) => row.get(i) || 1);
  let r = [...rhs];
  let z = r.map((v, i) => v / diag[i]);
  let p = [...z];
  let rz = r.reduce((s, v, i) => s + v * z[i], 0);
  const rhsNorm = Math.hypot(...rhs) || 1;
  let converged = false;
  for (let it = 0; it < 10000; it += 1) {
    const Ap = A.map((row) => { let s = 0; for (const [c, v] of row) s += v * p[c]; return s; });
    const pAp = p.reduce((s, v, i) => s + v * Ap[i], 0);
    if (pAp === 0) break;
    const alpha = rz / pAp;
    for (let i = 0; i < m; i += 1) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
    if (Math.hypot(...r) <= 1e-12 * rhsNorm) { converged = true; break; }
    z = r.map((v, i) => v / diag[i]);
    const rzNew = r.reduce((s, v, i) => s + v * z[i], 0);
    const beta = rzNew / rz;
    for (let i = 0; i < m; i += 1) p[i] = z[i] + beta * p[i];
    rz = rzNew;
  }
  if (!converged) return { notComputed: "solver_not_converged:cg did not reach 1e-12 relative residual in 10000 iterations" };
  const uh = new Array(nodes).fill(0);
  interior.forEach((node, k) => { uh[node] = x[k]; });
  // errors by 3-point quadrature per element
  let l2 = 0;
  let h1 = 0;
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) {
    const tris = [
      [idx(i, j), idx(i + 1, j), idx(i, j + 1)],
      [idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)],
    ];
    for (const tri of tris) {
      const pts = tri.map((k) => { const [a, b] = coord(k); return [a * h, b * h]; });
      const [[ax, ay], [bx, by], [cx, cy]] = pts;
      const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
      const bvec = [by - cy, cy - ay, ay - by];
      const cvec = [cx - bx, ax - cx, bx - ax];
      const vals = tri.map((k) => uh[k]);
      const guh = [0, 1].map((d) => vals.reduce((s, v, p) => s + v * (d === 0 ? bvec[p] : cvec[p]), 0) / (2 * area));
      const mids = [[(ax + bx) / 2, (ay + by) / 2], [(bx + cx) / 2, (by + cy) / 2], [(cx + ax) / 2, (cy + ay) / 2]];
      const bary = [[0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]];
      mids.forEach(([mx, my], q) => {
        const uFE = vals.reduce((s, v, p) => s + v * bary[q][p], 0);
        const e = uFE - sol.u(mx, my);
        l2 += (area / 3) * e * e;
        const g = sol.grad(mx, my);
        h1 += (area / 3) * ((guh[0] - g[0]) ** 2 + (guh[1] - g[1]) ** 2);
      });
    }
  }
  return { h, l2Error: Math.sqrt(l2), h1Error: Math.sqrt(h1) };
}

/* ---------------- order estimation ---------------- */

function observedOrder(rows, key) {
  // least-squares slope of log(err) vs log(h): err ~ h^p, so the slope IS p
  const xs = rows.map((r) => Math.log(r.h));
  const ys = rows.map((r) => Math.log(r[key]));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return num / den;
}

/* ---------------- run ---------------- */

function runMms(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (target === "symbolic-source" || target === "engine") {
    return { notComputed: "requires_engine_tier:sxe-02" };
  }
  if (target !== "mms") {
    return { notComputed: `unknown_target:${target} (known: mms, symbolic-source, engine)` };
  }
  const problem = inputs.problem;
  if (typeof problem !== "string" || !LIBRARY[problem]) {
    return { notComputed: `missing_input:problem (one of: ${Object.keys(LIBRARY).join(", ")}; an arbitrary PDE/manufactured pair is the engine tier, requires_engine_tier:sxe-02)` };
  }
  const spec = LIBRARY[problem];
  const solutionName = inputs.solution ?? Object.keys(spec.solutions)[0];
  const sol = spec.solutions[solutionName];
  if (!sol) {
    return { notComputed: `invalid_input:solution '${solutionName}' is not in the ${problem} library (${Object.keys(spec.solutions).join(", ")}); an arbitrary manufactured solution needs its source derived symbolically — requires_engine_tier:sxe-02` };
  }
  const meshes = inputs.meshes ?? spec.defaultMeshes;
  if (!Array.isArray(meshes) || meshes.length < 3 || !meshes.every((v, i) => Number.isInteger(v) && v >= 4 && (i === 0 || v > meshes[i - 1]))) {
    return { notComputed: "invalid_input:meshes must be at least three strictly increasing integers >= 4 (an order estimate needs a sequence)" };
  }
  if (meshes[meshes.length - 1] > spec.maxMesh) {
    return { notComputed: `size_above_envelope:meshes for ${problem} are capped at ${spec.maxMesh} at the JS tier (larger sequences: requires_engine_tier:fenicsx)` };
  }
  const rows = [];
  for (const n of meshes) {
    const r = spec.kind === "1d" ? solvePoisson1D(sol, n) : solvePoisson2D(sol, n);
    if (r.notComputed) return r;
    rows.push({ n, ...r });
  }
  const obsL2 = observedOrder(rows, "l2Error");
  const warnings = [];
  const monotone = rows.every((r, i) => i === 0 || r.l2Error < rows[i - 1].l2Error);
  if (!monotone) warnings.push("l2 errors are not monotone decreasing over the mesh sequence — the discretization or the solve is suspect");
  if (Math.abs(obsL2 - spec.theory.l2) > spec.band) {
    warnings.push(`observed L2 order ${obsL2.toFixed(3)} is outside the declared band ±${spec.band} around the theoretical order ${spec.theory.l2} — a finding about the code under test, reported as measured`);
  }
  const outputs = {
    problem, solution: solutionName,
    theoreticalOrder: spec.theory,
    rows: rows.map((r) => ({ n: r.n, h: r.h, l2Error: r.l2Error, ...(r.maxError !== undefined ? { maxError: r.maxError } : {}), ...(r.h1Error !== undefined ? { h1Error: r.h1Error } : {}) })),
    observedOrder: { l2: obsL2 },
    verdict: warnings.length === 0 ? "order_confirmed" : "order_not_confirmed",
  };
  if (spec.kind === "2d") {
    const obsH1 = observedOrder(rows, "h1Error");
    outputs.observedOrder.h1 = obsH1;
    if (Math.abs(obsH1 - spec.theory.h1) > spec.band) {
      warnings.push(`observed H1 order ${obsH1.toFixed(3)} is outside the declared band ±${spec.band} around the theoretical order ${spec.theory.h1}`);
      outputs.verdict = "order_not_confirmed";
    }
  }
  return {
    inputs: { problem, solution: solutionName, meshes },
    outputs,
    ...(warnings.length ? { warnings } : {}),
    margins: [],
    covers: [target],
  };
}

export const verifyMms = registerSolver({
  id: "verify.mms",
  version: "1.0.0",
  domain: "verification",
  domains: ["verification"],
  fidelity: 3,
  method: "method of manufactured solutions over a hand-derived library: Poisson 1D central FD (Thomas solve), Poisson 2D P1 FEM (CG solve, Jacobi-preconditioned); observed orders by least squares over the mesh sequence (Roache; Salari & Knupp SAND2000-1444)",
  reference: "Roache, Fundamentals of Verification and Validation; Salari & Knupp SAND2000-1444 — reference case: Poisson MMS observed order 2 (P1 FEM L2 / FD), H1 order 1",
  regime: "built-in library only (poisson-1d: sin, poly; poisson-2d: sin-product, poly); meshes >= 3 strictly increasing levels, caps 640 (1D) / 48 (2D); arbitrary manufactured solutions and per-engine MMS are the SXE-02 engine tier, refused by name",
  units: { inputs: "problem + solution names, mesh counts (dimensionless)", outputs: "per-mesh L2/H1/max errors and observed orders of accuracy (dimensionless)" },
  tolerance: "verdict band ±0.35 around the theoretical order; non-monotone errors or an out-of-band order serve as WARN with the measurement as taken",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runMms,
});
