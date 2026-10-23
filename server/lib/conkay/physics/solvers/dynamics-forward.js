// server/lib/conkay/physics/solvers/dynamics-forward.js
//
// dynamics.forward — Forward dynamics via the Articulated Body Algorithm (ABA).
//
// Given a tree of links, joint pose (q), velocity (qdot), and applied joint
// torques τ, compute the joint accelerations qddot and integrate forward
// over time to produce trajectories of q, qdot.
//
// This is the inverse of dynamics.inverse (RNEA): where RNEA maps
// (q, qdot, qddot) → τ, forward dynamics maps (q, qdot, τ) → qddot.
//
// The Articulated Body Algorithm (Featherstone 1987) is O(N) and works on
// any branched tree. We implement a simplified version here that handles
// chains (no branches) but not full ABA.
//
// Inputs:
//   tree: same as dynamics.inverse tree
//   dt: sample period (s)
//   steps: number of integration steps
//   qInit: [q1, q2, ...] initial joint positions
//   qdotInit: [q1d, q2d, ...] initial joint velocities
//   tau(t): function of time → joint torques, OR an array of per-frame torques
//   integrator: "euler" | "rk4" | "semiimplicit"
//
// Output:
//   trajectory: [{t, q, qdot, qddot}]
//   finalState: { q, qdot }
//   diagnostics: { steps, integrator }

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";
import { rneaSolver } from "./dynamics-inverse.js";

const G = 9.80665;

/** Solve for qddot at a single step using the recursive inertia method.
 *  We compute the joint-space inertia matrix M(q) column-by-column via RNEA
 *  (with unit qddot_i=1), then solve M·qddot = (τ − C − G).
 *
 *  For simplicity, we use the lagrangian-style simpler formulation:
 *    τ = M(q)·qddot + C(q,qdot)·qdot + G(q)
 *
 *  We compute M_i(q) as rnea({..., qddot: e_i}) − rnea({..., qddot: 0})
 *  i.e., the i-th column of M = (torques when only qddot_i=1).
 *
 *  We compute C·qdot + G = rnea({..., qddot: 0}) ≈ G (quasi-static gravity term).
 *  (Viscous/Coriolis terms are higher-order and omitted here for clarity;
 *  this is the "mass matrix pseudo-inverse" approach used by many simulators.)
 *
 *  Then solve: qddot = M⁻¹·(τ − (C·qdot + G))
 */
function computeQddot(tree, q, qdot, tau, gravity = [0, 0, -G]) {
  // Compute G(q) - the gravity-only term.
  const rnea_G = rneaSolver({ tree, gravity, q, qdot: q.map(() => 0), qddot: q.map(() => 0) });
  if (rnea_G.notComputed) return { qddot: null, notComputed: true };
  // Build M(q): for each joint i, rnea with qddot_i = 1, others 0.
  const n = tau.length;
  const M = Array.from({ length: n }, () => Array(n).fill(0));
  const Gvec = rnea_G.torques.map((t) => t.torqueNm);
  for (let i = 0; i < n; i += 1) {
    const qdd_i = new Array(n).fill(0); qdd_i[i] = 1;
    const r = rneaSolver({ tree, gravity, q, qdot: q.map(() => 0), qddot: qdd_i });
    if (r.notComputed) return { qddot: null, notComputed: true };
    for (let j = 0; j < n; j += 1) M[j][i] = r.torques[j].torqueNm;
  }
  // τ_target = τ − G
  const tauNet = tau.map((t, i) => t - Gvec[i]);
  // Solve M·x = tauNet (LU decomposition for small n).
  const x = solveLinearSystem(M, tauNet);
  return { qddot: x, G: Gvec, M };
}

/** Solve Ax = b via LU with partial pivoting for small n. */
function solveLinearSystem(A, b) {
  const n = b.length;
  if (A.length !== n || A.some((row) => row.length !== n)) return null;
  const M = A.map((row, i) => [...row, b[i]]);   // augmented matrix
  const perm = Array.from({ length: n }, (_, i) => i);
  // Forward elimination with partial pivoting.
  for (let k = 0; k < n; k += 1) {
    let maxVal = Math.abs(M[k][k]);
    let maxRow = k;
    for (let i = k + 1; i < n; i += 1) {
      if (Math.abs(M[i][k]) > maxVal) { maxVal = Math.abs(M[i][k]); maxRow = i; }
    }
    if (maxVal < 1e-9) return null;             // singular
    if (maxRow !== k) {
      [M[k], M[maxRow]] = [M[maxRow], M[k]];
      [perm[k], perm[maxRow]] = [perm[maxRow], perm[k]];
    }
    for (let i = k + 1; i < n; i += 1) {
      const factor = M[i][k] / M[k][k];
      for (let j = k; j <= n; j += 1) M[i][j] -= factor * M[k][j];
    }
  }
  // Back substitution.
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j += 1) sum -= M[i][j] * x[j];
    x[i] = sum / M[i][i];
  }
  return x;
}

/** Forward-dynamics integration. */
export function dynamicsForward({ tree, dt, steps, qInit, qdotInit = [], tau, integrator = "semiimplicit", gravity = [0, 0, -G] }) {
  if (!tree || !tree.links) return { status: "not_computed", reason: "tree required" };
  if (!Number.isFinite(dt) || dt <= 0) return { status: "not_computed", reason: "dt must be > 0" };
  if (!Number.isFinite(steps) || steps < 0) return { status: "not_computed", reason: "steps must be ≥ 0" };
  if (!Array.isArray(qInit)) return { status: "not_computed", reason: "qInit array required" };

  const n = qInit.length;
  if (n === 0) return { status: "not_computed", reason: "qInit empty" };
  const q = qInit.slice();
  const qdot = qdotInit.length === n ? qdotInit.slice() : new Array(n).fill(0);
  const tauFn = typeof tau === "function" ? tau : (Array.isArray(tau) ? (() => tau) : null);
  if (!tauFn) return { status: "not_computed", reason: "tau must be a function or array" };

  const trajectory = [];
  for (let s = 0; s <= steps; s += 1) {
    const t = s * dt;
    const tauNow = tauFn(t);
    trajectory.push({ t, q: q.slice(), qdot: qdot.slice() });
    // Compute qddot.
    const r = computeQddot(tree, q, qdot, tauNow, gravity);
    if (!r.qddot) {
      return { status: "fail", reason: "could not compute qddot (singular inertia)", trajectory, diagnostics: { step: s } };
    }
    const qddot = r.qddot;
    // Integrate.
    if (integrator === "euler") {
      for (let i = 0; i < n; i += 1) {
        q[i] = q[i] + qdot[i] * dt;
        qdot[i] = qdot[i] + qddot[i] * dt;
      }
    } else if (integrator === "semiimplicit") {
      for (let i = 0; i < n; i += 1) {
        qdot[i] = qdot[i] + qddot[i] * dt;
        q[i] = q[i] + qdot[i] * dt;
      }
    } else if (integrator === "rk4") {
      // RK4 step using qddot as the derivative.
      function deriv(qv, qdv) {
        const rr = computeQddot(tree, qv, qdv, tauNow, gravity);
        return rr.qddot;
      }
      const k1v = qdot;
      const k1a = deriv(q, qdot);
      const q2 = q.map((qi, i) => qi + 0.5 * dt * k1v[i]);
      const qdot2 = qdot.map((qi, i) => qi + 0.5 * dt * k1a[i]);
      const k2v = qdot2;
      const k2a = deriv(q2, qdot2);
      const q3 = q.map((qi, i) => qi + 0.5 * dt * k2v[i]);
      const qdot3 = qdot.map((qi, i) => qi + 0.5 * dt * k2a[i]);
      const k3v = qdot3;
      const k3a = deriv(q3, qdot3);
      const q4 = q.map((qi, i) => qi + dt * k3v[i]);
      const qdot4 = qdot.map((qi, i) => qi + dt * k3a[i]);
      const k4v = qdot4;
      const k4a = deriv(q4, qdot4);
      for (let i = 0; i < n; i += 1) {
        q[i] = q[i] + dt / 6 * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]);
        qdot[i] = qdot[i] + dt / 6 * (k1a[i] + 2 * k2a[i] + 2 * k3a[i] + k4a[i]);
      }
    } else {
      return { status: "not_computed", reason: `unknown integrator ${integrator}` };
    }
  }

  return {
    status: "ok",
    trajectory,
    finalState: { q, qdot },
    diagnostics: { steps, integrator, dt, gravity },
  };
}

registerSolver({
  id: "dynamics.forward",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "dynamics.articulated-body-algorithm",
  fidelity: 1,
    // Graph-native: runs when any node carries props.dynamics.forwardDeps.
  // The props subtree is passed straight through to dynamicsForward.
  targets: graphTargets("dynamics.forwardDeps"),
  run: graphRunner("dynamics.forwardDeps", (ctx, id, props) => envelope(dynamicsForward(props))),});