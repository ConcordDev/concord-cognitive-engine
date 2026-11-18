// server/lib/conkay/physics/solvers/pde-fem.js
//
// math.pde-fem — SX-NUM-10 (ConKay solver catalogue, Wave 0).
//
// Finite elements at the JS tier: P1 (linear) elements for the
// Poisson class — -Delta u = f — on 1D intervals and structured
// 2D rectangles with Dirichlet boundary data as expressions.
// The catalogue's reference discipline is MMS (the method of
// manufactured solutions), and it is built into the answer
// contract rather than left to the caller:
//
//   - every solve runs at mesh N and 2N; the nodal difference at
//     shared nodes is the reported error estimate, and if it
//     exceeds the declared tolerance the answer is NOT_COMPUTED;
//   - when the caller declares the manufactured exact solution
//     (`exact`, an expression), the true errors at both meshes
//     give the OBSERVED ORDER, which must sit in the P1 band
//     [1.7, 2.3] or the answer is NOT_COMPUTED
//     observed_order_outside_band — a discretization that is not
//     converging at its element's rate is a defect, not a result.
//
// General weak forms (UFL), adaptivity, and MPI are the FEniCSx
// engine tier, refused by name. Node caps keep the dense JS
// solve inside its envelope; larger meshes name the tier too.

import { registerSolver } from "../registry.js";
import { parse, evaluateAst } from "./math-symbolic.js";
import { luFactor } from "./linsolve.js";

const MAX_NODES_1D = 1025;
const MAX_NODES_2D = 1600;
const ORDER_BAND = [1.7, 2.3];

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

function compileExpr(src, what) {
  if (typeof src !== "string" || !src.trim()) return { refusal: `missing_input:${what} (an expression string; SC-03: nothing is assumed)` };
  try {
    return { ast: parse(src) };
  } catch (err) {
    return { refusal: `invalid_input:${what} ${err.message}` };
  }
}

const evalAt = (ast, env) => {
  const v = evaluateAst(ast, env);
  if (!Number.isFinite(v)) throw new Error("expression evaluation is not finite");
  return v;
};

/* ---------------- 1D P1 ---------------- */

function solvePoisson1d(fAst, exactAst, a, b, uA, uB, N) {
  const h = (b - a) / N;
  const n = N + 1;
  // dense system on interior nodes 1..N-1, Dirichlet folded in
  const m = N - 1;
  const A = Array.from({ length: m }, () => new Array(m).fill(0));
  const rhs = new Array(m).fill(0);
  const gauss = [[0.5 - Math.sqrt(3) / 6, 0.5], [0.5 + Math.sqrt(3) / 6, 0.5]]; // points in [0,1], weights
  for (let e = 0; e < N; e += 1) {
    const x0 = a + e * h;
    // element stiffness (1/h) [[1,-1],[-1,1]]
    const nodes = [e, e + 1];
    const inner = (node) => node >= 1 && node <= N - 1; // interior unknowns only
    for (let i = 0; i < 2; i += 1) {
      for (let j = 0; j < 2; j += 1) {
        if (inner(nodes[i]) && inner(nodes[j])) A[nodes[i] - 1][nodes[j] - 1] += (i === j ? 1 : -1) / h;
      }
      // load: integral of f * phi_i over the element (2-pt Gauss)
      let load = 0;
      for (const [s, w] of gauss) {
        const x = x0 + s * h;
        const phi = i === 0 ? 1 - s : s;
        load += w * evalAt(fAst, { x }) * phi;
      }
      load *= h;
      if (inner(nodes[i])) rhs[nodes[i] - 1] += load; // boundary-node loads fold through the Dirichlet rows
    }
  }
  // fold Dirichlet values into the rhs of their interior neighbours
  // element 0 couples node 1 to uA with -uA/h; element N-1 couples
  // node N-1 to uB with -uB/h
  if (m >= 1) { rhs[0] += uA / h; rhs[m - 1] += uB / h; }
  const fact = luFactor(A);
  if (fact.singularAt !== undefined) return { refusal: "singular_system:the 1D stiffness system is singular" };
  const interior = luSolve(fact, rhs);
  const u = new Array(n);
  u[0] = uA;
  u[N] = uB;
  for (let i = 1; i < N; i += 1) u[i] = interior[i - 1];
  const xs = Array.from({ length: n }, (_, i) => a + i * h);
  let exactError = null;
  if (exactAst) {
    // L2 (RMS) error of the piecewise-linear solution against the
    // exact one, by 2-point Gauss per element. (Nodal errors in 1D
    // are superconvergent — order ~4 by the Green's-function
    // argument — so the order band applies to the L2 measure,
    // where P1's classical rate is 2.)
    let acc = 0;
    for (let e = 0; e < N; e += 1) {
      for (const [s, w] of gauss) {
        const x = a + (e + s) * h;
        const uh = u[e] * (1 - s) + u[e + 1] * s;
        acc += h * w * (uh - evalAt(exactAst, { x })) ** 2;
      }
    }
    exactError = Math.sqrt(acc / (b - a));
  }
  return { xs, u, exactError };
}

/* ---------------- 2D P1 on a structured rectangle ---------------- */

function solvePoisson2d(fAst, gAst, exactAst, dom, nx, ny) {
  const { x0, x1, y0, y1 } = dom;
  const hx = (x1 - x0) / nx;
  const hy = (y1 - y0) / ny;
  const nxN = nx + 1;
  const nyN = ny + 1;
  const total = nxN * nyN;
  const idx = (i, j) => j * nxN + i;
  const isBoundary = (i, j) => i === 0 || j === 0 || i === nx || j === ny;
  const A = Array.from({ length: total }, () => new Array(total).fill(0));
  const rhs = new Array(total).fill(0);
  const nodeXY = (id) => [x0 + (id % nxN) * hx, y0 + Math.floor(id / nxN) * hy];
  // triangles: each rectangle split along the (i,j)-(i+1,j+1) diagonal
  const tris = [];
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const n00 = idx(i, j);
      const n10 = idx(i + 1, j);
      const n01 = idx(i, j + 1);
      const n11 = idx(i + 1, j + 1);
      tris.push([n00, n10, n11], [n00, n11, n01]);
    }
  }
  for (const tri of tris) {
    const [p, q, r] = tri.map(nodeXY);
    const area2 = (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
    const area = Math.abs(area2) / 2;
    // gradients of the three P1 basis functions
    const grads = [
      [(q[1] - r[1]) / area2, (r[0] - q[0]) / area2],
      [(r[1] - p[1]) / area2, (p[0] - r[0]) / area2],
      [(p[1] - q[1]) / area2, (q[0] - p[0]) / area2],
    ];
    const centroid = [(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3];
    const fc = evalAt(fAst, { x: centroid[0], y: centroid[1] });
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        A[tri[i]][tri[j]] += area * (grads[i][0] * grads[j][0] + grads[i][1] * grads[j][1]);
      }
      rhs[tri[i]] += (fc * area) / 3;
    }
  }
  // Dirichlet boundary: identity rows with g values
  for (let j = 0; j < nyN; j += 1) {
    for (let i = 0; i < nxN; i += 1) {
      if (!isBoundary(i, j)) continue;
      const id = idx(i, j);
      A[id].fill(0);
      A[id][id] = 1;
      rhs[id] = evalAt(gAst, { x: x0 + i * hx, y: y0 + j * hy });
    }
  }
  const fact = luFactor(A);
  if (fact.singularAt !== undefined) return { refusal: "singular_system:the 2D stiffness system is singular" };
  const u = luSolve(fact, rhs);
  let exactError = null;
  if (exactAst) {
    // L2 (RMS) error: per triangle, the 3 edge-midpoint rule
    // applied to (u_h - exact)^2, u_h linear so its midpoint value
    // is the average of the edge's nodal values.
    let acc = 0;
    for (const tri of tris) {
      const [p, q, r] = tri.map(nodeXY);
      const area = Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2;
      const mids = [
        [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (u[tri[0]] + u[tri[1]]) / 2],
        [(q[0] + r[0]) / 2, (q[1] + r[1]) / 2, (u[tri[1]] + u[tri[2]]) / 2],
        [(r[0] + p[0]) / 2, (r[1] + p[1]) / 2, (u[tri[2]] + u[tri[0]]) / 2],
      ];
      for (const [mx, my, uh] of mids) acc += (area / 3) * (uh - evalAt(exactAst, { x: mx, y: my })) ** 2;
    }
    exactError = Math.sqrt(acc / ((x1 - x0) * (y1 - y0)));
  }
  return { u, nxN, nyN, exactError, nodeXY };
}

/* ---------------- the solver ---------------- */

function finishWithMms({ coarse, fine, estimate, exactCoarse, exactFine, tol, outputs }) {
  if (estimate > tol) {
    return { notComputed: `not_converged:mesh-doubling estimate ${estimate} exceeds tol ${tol}; the coarse answer is not served (refine the mesh or loosen tol)` };
  }
  const result = { outputs: { ...outputs, meshErrorEstimate: estimate }, margins: [] };
  if (exactCoarse !== null && exactFine !== null) {
    const order = Math.log2(exactCoarse / exactFine);
    result.outputs.observedOrder = order;
    result.outputs.exactErrorFine = exactFine;
    if (!(order >= ORDER_BAND[0] && order <= ORDER_BAND[1])) {
      return { notComputed: `observed_order_outside_band:P1 elements must converge at order ~2; observed ${order} (errors ${exactCoarse} -> ${exactFine}) — the discretization or the declared exact solution is wrong` };
    }
  }
  return result;
}

function runFem(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (!["poisson1d", "poisson2d"].includes(target)) {
    return { notComputed: `unknown_operation:${target} (general weak forms / adaptivity / MPI: requires_engine_tier:fenicsx)` };
  }
  const tol = inputs.tol === undefined ? 1e-4 : inputs.tol;
  if (!(tol > 0)) return { notComputed: "invalid_input:tol must be positive" };
  const fC = compileExpr(inputs.f, "f");
  if (fC.refusal) return { notComputed: fC.refusal };
  let exactAst = null;
  if (inputs.exact !== undefined) {
    const eC = compileExpr(inputs.exact, "exact");
    if (eC.refusal) return { notComputed: eC.refusal };
    exactAst = eC.ast;
  }

  if (target === "poisson1d") {
    const { a, b } = inputs;
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return { notComputed: "missing_input:finite a and b with a != b" };
    const uA = inputs.uA === undefined ? 0 : inputs.uA;
    const uB = inputs.uB === undefined ? 0 : inputs.uB;
    if (!Number.isFinite(uA) || !Number.isFinite(uB)) return { notComputed: "invalid_input:uA and uB must be finite numbers" };
    const N0 = Number.isInteger(inputs.mesh) && inputs.mesh >= 4 ? inputs.mesh : 32;
    if (2 * N0 + 1 > MAX_NODES_1D) return { notComputed: `mesh_too_large:${2 * N0 + 1} nodes exceeds the JS tier cap ${MAX_NODES_1D} (larger meshes: requires_engine_tier:fenicsx)` };
    let coarse;
    let fine;
    try {
      coarse = solvePoisson1d(fC.ast, exactAst, a, b, uA, uB, N0);
      fine = solvePoisson1d(fC.ast, exactAst, a, b, uA, uB, 2 * N0);
    } catch (err) {
      return { notComputed: `evaluation_failed:${err.message}` };
    }
    if (coarse.refusal) return { notComputed: coarse.refusal };
    if (fine.refusal) return { notComputed: fine.refusal };
    let estimate = 0;
    for (let i = 0; i <= N0; i += 1) estimate = Math.max(estimate, Math.abs(fine.u[2 * i] - coarse.u[i]));
    const done = finishWithMms({
      coarse, fine, estimate,
      exactCoarse: coarse.exactError, exactFine: fine.exactError, tol,
      outputs: { nodes: fine.xs.map((x, i) => ({ x, u: fine.u[i] })), mesh: 2 * N0 },
    });
    if (done.notComputed) return done;
    return { inputs: { a, b, uA, uB, tol, mesh: 2 * N0 }, ...done, covers: [target] };
  }

  // poisson2d
  const dom = inputs.domain;
  if (!dom || ![dom.x0, dom.x1, dom.y0, dom.y1].every(Number.isFinite) || dom.x0 === dom.x1 || dom.y0 === dom.y1) {
    return { notComputed: "missing_input:domain {x0, x1, y0, y1} with x0 != x1 and y0 != y1" };
  }
  const gC = compileExpr(inputs.boundary === undefined ? "0" : inputs.boundary, "boundary");
  if (gC.refusal) return { notComputed: gC.refusal };
  const nx0 = Number.isInteger(inputs.mesh?.nx) && inputs.mesh.nx >= 2 ? inputs.mesh.nx : 16;
  const ny0 = Number.isInteger(inputs.mesh?.ny) && inputs.mesh.ny >= 2 ? inputs.mesh.ny : 16;
  if ((2 * nx0 + 1) * (2 * ny0 + 1) > MAX_NODES_2D) {
    return { notComputed: `mesh_too_large:${(2 * nx0 + 1) * (2 * ny0 + 1)} nodes exceeds the JS tier cap ${MAX_NODES_2D} (larger meshes: requires_engine_tier:fenicsx)` };
  }
  let coarse;
  let fine;
  try {
    coarse = solvePoisson2d(fC.ast, gC.ast, exactAst, dom, nx0, ny0);
    fine = solvePoisson2d(fC.ast, gC.ast, exactAst, dom, 2 * nx0, 2 * ny0);
  } catch (err) {
    return { notComputed: `evaluation_failed:${err.message}` };
  }
  if (coarse.refusal) return { notComputed: coarse.refusal };
  if (fine.refusal) return { notComputed: fine.refusal };
  let estimate = 0;
  for (let j = 0; j <= ny0; j += 1) {
    for (let i = 0; i <= nx0; i += 1) {
      estimate = Math.max(estimate, Math.abs(fine.u[(2 * j) * fine.nxN + 2 * i] - coarse.u[j * coarse.nxN + i]));
    }
  }
  // the fine mesh (2*nx0 by 2*ny0 cells) has a node exactly at the
  // domain center: (nx0, ny0) in fine node indexing
  const centerValue = fine.u[ny0 * fine.nxN + nx0];
  const done = finishWithMms({
    coarse, fine, estimate,
    exactCoarse: coarse.exactError, exactFine: fine.exactError, tol,
    outputs: {
      mesh: { nx: 2 * nx0, ny: 2 * ny0 },
      centerValue,
      nodes: fine.u.map((u, id) => {
        const [x, y] = fine.nodeXY(id);
        return { x, y, u };
      }),
    },
  });
  if (done.notComputed) return done;
  return {
    inputs: { domain: dom, tol, mesh: { nx: 2 * nx0, ny: 2 * ny0 } },
    ...done,
    covers: [target],
  };
}

export const pdeFem = registerSolver({
  id: "math.pde-fem",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 4,
  method: "P1 finite elements for the Poisson class in 1D and on structured 2D rectangles, with MMS discipline built into the answer contract (mesh-doubling estimate + observed-order band); general weak forms (UFL), adaptivity and MPI are the FEniCSx engine tier",
  reference: "Method of manufactured solutions (MMS) convergence discipline, as seated by verify.mms (SX-XC-05); element formulation per standard P1 theory",
  regime: "-Delta u = f with Dirichlet data on intervals and rectangles; node caps 1025 (1D) / 1600 (2D); observed order must sit in [1.7, 2.3] when an exact solution is declared",
  units: { inputs: "f (and optional exact / boundary) expressions, domain, mesh, tol", outputs: "nodal solution with mesh error estimate and, when declared, observed order" },
  tolerance: "declared per call (default 1e-4) against the mesh-doubling estimate",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runFem,
});
