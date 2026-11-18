// server/lib/conkay/physics/solvers/pde-fdm-fvm.js
//
// math.pde-fdm-fvm — SX-NUM-11 (ConKay solver catalogue, Wave 0).
//
// Finite differences / finite volumes at the JS tier, after
// LeVeque (Finite Volume Methods for Hyperbolic Problems):
//
//   sod          1D Euler equations by Godunov's method — the
//                intercell flux is the EXACT Riemann solution
//                (Toro's pressure iteration), piecewise constant,
//                explicit in time. The catalogue's reference case
//                is the Sod shock tube against that same exact
//                solution, computed independently of the march.
//   advection    linear advection u_t + c u_x = 0 by upwind
//                finite volumes on a periodic domain; the exact
//                solution is the translated profile.
//   heat-cn      heat equation u_t = alpha u_xx by
//                Crank-Nicolson (unconditionally stable; the
//                stability fact is declared, not gated).
//
// Stability honesty: the time step is DERIVED from the declared
// CFL number and the mesh; a caller asking for CFL > 1 (or a
// non-positive CFL) is refused by name — an unstable march is
// never served. Every target runs at mesh N and 2N and ships
// the mesh-doubling estimate under the same contract as
// math.pde-fem. TVD limiters and unstructured grids are named
// follow-on scope.

import { registerSolver } from "../registry.js";
import { parse, evaluateAst } from "./math-symbolic.js";
import { luFactor } from "./linsolve.js";

const GAMMA = 1.4;

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

/* ---------- exact Riemann solver (Toro) ---------- */

// Star pressure/velocity for left/right states {rho, u, p}.
function riemannStar(L, R) {
  const g = GAMMA;
  const aL = Math.sqrt(g * L.p / L.rho);
  const aR = Math.sqrt(g * R.p / R.rho);
  const fK = (p, S, aS) => {
    if (p > S.p) {
      const A = 2 / ((g + 1) * S.rho);
      const B = ((g - 1) / (g + 1)) * S.p;
      return (p - S.p) * Math.sqrt(A / (p + B));
    }
    return (2 * aS / (g - 1)) * ((p / S.p) ** ((g - 1) / (2 * g)) - 1);
  };
  const fKp = (p, S, aS) => {
    if (p > S.p) {
      const A = 2 / ((g + 1) * S.rho);
      const B = ((g - 1) / (g + 1)) * S.p;
      return Math.sqrt(A / (p + B)) * (1 - (p - S.p) / (2 * (p + B)));
    }
    return (1 / (S.rho * aS)) * (p / S.p) ** (-(g + 1) / (2 * g));
  };
  let p = Math.max(1e-9, 0.5 * (L.p + R.p) - 0.125 * (R.u - L.u) * (L.rho + R.rho) * (aL + aR));
  for (let it = 0; it < 60; it += 1) {
    const f = fK(p, L, aL) + fK(p, R, aR) + (R.u - L.u);
    const fp = fKp(p, L, aL) + fKp(p, R, aR);
    const dp = f / fp;
    p -= dp;
    if (p <= 0) p = 1e-9;
    if (Math.abs(dp) < 1e-10 * Math.max(1, p)) break;
  }
  const u = 0.5 * (L.u + R.u) + 0.5 * (fK(p, R, aR) - fK(p, L, aL));
  return { p, u };
}

// Exact solution state at (x, t) for an initial discontinuity at x0.
function riemannSample(L, R, x0, x, t) {
  const g = GAMMA;
  if (t === 0) return x < x0 ? { ...L } : { ...R };
  const { p: pStar, u: uStar } = riemannStar(L, R);
  const aL = Math.sqrt(g * L.p / L.rho);
  const aR = Math.sqrt(g * R.p / R.rho);
  const s = (x - x0) / t;
  const starDensity = (S, aS) => (pStar > S.p
    ? S.rho * ((pStar / S.p + (g - 1) / (g + 1)) / (((g - 1) / (g + 1)) * (pStar / S.p) + 1))
    : S.rho * (pStar / S.p) ** (1 / g));
  if (s <= uStar) {
    // left of the contact
    if (pStar > L.p) {
      const sL = L.u - aL * Math.sqrt(((g + 1) / (2 * g)) * (pStar / L.p) + (g - 1) / (2 * g));
      if (s <= sL) return { ...L };
      return { rho: starDensity(L, aL), u: uStar, p: pStar };
    }
    const sHead = L.u - aL;
    const aStarL = aL * (pStar / L.p) ** ((g - 1) / (2 * g));
    const sTail = uStar - aStarL;
    if (s <= sHead) return { ...L };
    if (s >= sTail) return { rho: starDensity(L, aL), u: uStar, p: pStar };
    const u = (2 / (g + 1)) * (aL + ((g - 1) / 2) * L.u + s);
    const a = (2 / (g + 1)) * (aL + ((g - 1) / 2) * (L.u - s));
    const rho = L.rho * (a / aL) ** (2 / (g - 1));
    const p = L.p * (a / aL) ** (2 * g / (g - 1));
    return { rho, u, p };
  }
  // right of the contact
  if (pStar > R.p) {
    const sR = R.u + aR * Math.sqrt(((g + 1) / (2 * g)) * (pStar / R.p) + (g - 1) / (2 * g));
    if (s >= sR) return { ...R };
    return { rho: starDensity(R, aR), u: uStar, p: pStar };
  }
  const sHead = R.u + aR;
  const aStarR = aR * (pStar / R.p) ** ((g - 1) / (2 * g));
  const sTail = uStar + aStarR;
  if (s >= sHead) return { ...R };
  if (s <= sTail) return { rho: starDensity(R, aR), u: uStar, p: pStar };
  const u = (2 / (g + 1)) * (-aR + ((g - 1) / 2) * R.u + s);
  const a = (2 / (g + 1)) * (aR - ((g - 1) / 2) * (R.u - s));
  const rho = R.rho * (a / aR) ** (2 / (g - 1));
  const p = R.p * (a / aR) ** (2 * g / (g - 1));
  return { rho, u, p };
}

const primToCons = ({ rho, u, p }) => [rho, rho * u, p / (GAMMA - 1) + 0.5 * rho * u * u];
const consToPrim = ([rho, m, E]) => ({ rho, u: m / rho, p: (GAMMA - 1) * (E - 0.5 * m * m / rho) });
const physFlux = ({ rho, u, p }) => [rho * u, rho * u * u + p, u * (p / (GAMMA - 1) + 0.5 * rho * u * u + p)];

function marchSod(N, tEnd, cfl) {
  const dx = 1 / N;
  const x0 = 0.5;
  const L = { rho: 1, u: 0, p: 1 };
  const R = { rho: 0.125, u: 0, p: 0.1 };
  let U = Array.from({ length: N }, (_, i) => primToCons((i + 0.5) * dx < x0 ? L : R));
  let t = 0;
  let steps = 0;
  let maxCfl = 0;
  while (t < tEnd - 1e-14) {
    let smax = 0;
    for (const cell of U) {
      const pr = consToPrim(cell);
      smax = Math.max(smax, Math.abs(pr.u) + Math.sqrt(GAMMA * pr.p / pr.rho));
    }
    const dt = Math.min((cfl * dx) / smax, tEnd - t);
    maxCfl = Math.max(maxCfl, (smax * dt) / dx);
    const F = [];
    for (let i = 0; i <= N; i += 1) {
      const leftPrim = consToPrim(U[Math.max(0, i - 1)]);
      const rightPrim = consToPrim(U[Math.min(N - 1, i)]);
      const star = riemannSample(leftPrim, rightPrim, 0, 0, 1); // state at the interface (s = 0)
      // riemannSample with t = 1, x = x0 = 0 gives the interface state at s = 0
      F.push(physFlux(star));
    }
    const next = U.map((cell, i) => cell.map((v, k) => v - (dt / dx) * (F[i + 1][k] - F[i][k])));
    U = next;
    t += dt;
    steps += 1;
    if (steps > 200000) return { refusal: "step_budget_exceeded:the march exceeded 200000 steps" };
  }
  return { cells: U.map(consToPrim), dx, steps, maxCfl };
}

/* ---------- the solver ---------- */

function checkCfl(inputs) {
  const cfl = inputs.cfl === undefined ? 0.9 : inputs.cfl;
  if (!(cfl > 0) || cfl > 1) return { refusal: `invalid_input:cfl must lie in (0, 1] — got ${cfl}; a step violating the CFL condition is refused, never marched (LeVeque ch. 6)` };
  return { cfl };
}

function runFdmFvm(ctx, target) {
  const inputs = ctx?.inputs || {};
  const tol = inputs.tol === undefined ? 5e-3 : inputs.tol;
  if (!(tol > 0)) return { notComputed: "invalid_input:tol must be positive" };

  if (target === "sod") {
    const cc = checkCfl(inputs);
    if (cc.refusal) return { notComputed: cc.refusal };
    const tEnd = inputs.t === undefined ? 0.2 : inputs.t;
    if (!(tEnd > 0)) return { notComputed: "invalid_input:t must be positive" };
    const N0 = Number.isInteger(inputs.mesh) && inputs.mesh >= 20 ? inputs.mesh : 100;
    if (2 * N0 > 800) return { notComputed: `mesh_too_large:${2 * N0} cells exceeds the JS tier cap 800 for the Euler march` };
    const coarse = marchSod(N0, tEnd, cc.cfl);
    if (coarse.refusal) return { notComputed: coarse.refusal };
    const fine = marchSod(2 * N0, tEnd, cc.cfl);
    if (fine.refusal) return { notComputed: fine.refusal };
    // mesh-doubling estimate: mean |rho difference| at shared centers
    let est = 0;
    for (let i = 0; i < N0; i += 1) est += Math.abs(fine.cells[2 * i].rho - coarse.cells[i].rho);
    est /= N0;
    if (est > tol) return { notComputed: `not_converged:mesh-doubling L1 estimate ${est} exceeds tol ${tol}; refine the mesh or loosen tol` };
    // exact-solution comparison (independent of the march)
    const L = { rho: 1, u: 0, p: 1 };
    const R = { rho: 0.125, u: 0, p: 0.1 };
    let l1 = 0;
    const samples = {};
    for (let i = 0; i < 2 * N0; i += 1) {
      const x = (i + 0.5) * fine.dx;
      l1 += Math.abs(fine.cells[i].rho - riemannSample(L, R, 0.5, x, tEnd).rho);
    }
    l1 /= (2 * N0);
    for (const xs of [0.3, 0.55, 0.75, 0.9]) {
      const i = Math.min(2 * N0 - 1, Math.floor(xs / fine.dx));
      samples[`x${xs}`] = fine.cells[i];
    }
    return {
      inputs: { t: tEnd, cfl: cc.cfl, mesh: 2 * N0, tol },
      outputs: { l1ErrorVsExact: l1, meshErrorEstimate: est, steps: fine.steps, maxCflUsed: fine.maxCfl, samples },
      margins: [],
      covers: [target],
    };
  }

  if (target === "advection") {
    const cc = checkCfl(inputs);
    if (cc.refusal) return { notComputed: cc.refusal };
    const c = inputs.speed;
    if (!Number.isFinite(c) || c === 0) return { notComputed: "missing_input:speed (a finite nonzero advection speed)" };
    let profileAst;
    try {
      profileAst = parse(inputs.profile === undefined ? "sin(6.283185307179586*x)" : inputs.profile);
    } catch (err) {
      return { notComputed: `invalid_input:profile ${err.message}` };
    }
    const tEnd = inputs.t === undefined ? 1 : inputs.t;
    const N0 = Number.isInteger(inputs.mesh) && inputs.mesh >= 16 ? inputs.mesh : 100;
    const march = (N) => {
      const dx = 1 / N;
      let u = Array.from({ length: N }, (_, i) => evaluateAst(profileAst, { x: (i + 0.5) * dx }));
      const dt = (cc.cfl * dx) / Math.abs(c);
      const nsteps = Math.max(1, Math.round(tEnd / dt));
      const h = tEnd / nsteps;
      const nu = (c * h) / dx;
      for (let s = 0; s < nsteps; s += 1) {
        const prev = u.slice();
        for (let i = 0; i < N; i += 1) {
          u[i] = c > 0
            ? prev[i] - nu * (prev[i] - prev[(i - 1 + N) % N])
            : prev[i] + nu * (prev[(i + 1) % N] - prev[i]);
        }
      }
      return u;
    };
    const coarse = march(N0);
    const fine = march(2 * N0);
    let est = 0;
    for (let i = 0; i < N0; i += 1) est += Math.abs(fine[2 * i] - coarse[i]);
    est /= N0;
    if (est > tol) return { notComputed: `not_converged:mesh-doubling L1 estimate ${est} exceeds tol ${tol}` };
    let l1 = 0;
    for (let i = 0; i < 2 * N0; i += 1) {
      const x = (i + 0.5) / (2 * N0);
      const shifted = ((x - c * tEnd) % 1 + 1) % 1;
      l1 += Math.abs(fine[i] - evaluateAst(profileAst, { x: shifted }));
    }
    l1 /= (2 * N0);
    return {
      inputs: { speed: c, t: tEnd, cfl: cc.cfl, mesh: 2 * N0, tol },
      outputs: { l1ErrorVsExact: l1, meshErrorEstimate: est },
      margins: [],
      covers: [target],
    };
  }

  if (target === "heat-cn") {
    const alpha = inputs.alpha;
    if (!Number.isFinite(alpha) || alpha <= 0) return { notComputed: "missing_input:alpha (a positive diffusivity)" };
    const tEnd = inputs.t === undefined ? 0.5 : inputs.t;
    if (!(tEnd > 0)) return { notComputed: "invalid_input:t must be positive" };
    const N0 = Number.isInteger(inputs.mesh) && inputs.mesh >= 8 ? inputs.mesh : 32;
    if (2 * N0 > 512) return { notComputed: `mesh_too_large:${2 * N0} nodes exceeds the JS tier cap 512 for the CN solve` };
    const solve = (N) => {
      const dx = 1 / N;
      const m = N - 1;
      const dt = tEnd / Math.max(1, Math.round(tEnd / (0.4 * dx * dx / alpha)));
      const r = (alpha * dt) / (2 * dx * dx);
      const A = Array.from({ length: m }, () => new Array(m).fill(0));
      for (let i = 0; i < m; i += 1) {
        A[i][i] = 1 + 2 * r;
        if (i > 0) A[i][i - 1] = -r;
        if (i < m - 1) A[i][i + 1] = -r;
      }
      const fact = luFactor(A);
      let u = Array.from({ length: m }, (_, i) => Math.sin(Math.PI * (i + 1) * dx));
      const steps = Math.round(tEnd / dt);
      for (let s = 0; s < steps; s += 1) {
        const rhs = u.map((v, i) => r * (u[i - 1] ?? 0) + (1 - 2 * r) * v + r * (u[i + 1] ?? 0));
        u = luSolve(fact, rhs);
      }
      return { u, dx };
    };
    const coarse = solve(N0);
    const fine = solve(2 * N0);
    let est = 0;
    for (let i = 1; i < N0; i += 1) est = Math.max(est, Math.abs(fine.u[2 * i - 1] - coarse.u[i - 1]));
    if (est > tol) return { notComputed: `not_converged:mesh-doubling estimate ${est} exceeds tol ${tol}` };
    const center = fine.u[Math.floor(fine.u.length / 2)];
    const exactCenter = Math.exp(-alpha * Math.PI * Math.PI * tEnd);
    return {
      inputs: { alpha, t: tEnd, mesh: 2 * N0, tol },
      outputs: { centerValue: center, exactCenter, centerError: Math.abs(center - exactCenter), meshErrorEstimate: est },
      margins: [],
      covers: [target],
    };
  }

  return { notComputed: `unknown_operation:${target} (TVD limiters / unstructured grids are follow-on scope)` };
}

export const pdeFdmFvm = registerSolver({
  id: "math.pde-fdm-fvm",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 3,
  method: "Godunov finite volumes with the exact Riemann flux for the 1D Euler equations; upwind FVM for linear advection; Crank-Nicolson for the heat equation (LeVeque)",
  reference: "LeVeque, Finite Volume Methods for Hyperbolic Problems — the Sod shock tube against the exact Riemann solution (star pressure 0.30313, star velocity 0.92745, star densities 0.42632 / 0.26557)",
  regime: "structured 1D grids; CFL in (0, 1] enforced by construction and refused outside it; Euler mesh cap 800 cells; every answer carries a mesh-doubling estimate",
  units: { inputs: "target-specific (t, cfl, mesh, tol; speed/profile; alpha)", outputs: "cell states / nodal values with L1 error vs the exact solution where one exists" },
  tolerance: "declared per call (default 5e-3) against the mesh-doubling estimate",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runFdmFvm,
});
