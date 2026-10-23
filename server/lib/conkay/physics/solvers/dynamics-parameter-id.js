// server/lib/conkay/physics/solvers/dynamics-parameter-id.js
//
// dynamics.parameter-id — Linear least-squares identification of the two
// identifiable inertial combinations of a single revolute (z-axis) pendulum
// link from measured motion.
//
// Model
// -----
// A planar pendulum link rotates about the z axis at the joint origin.
// Its centre of mass is at local (a, 0, 0) (link mass m, scalar inertia
// about z through COM: Izz). Gravity g acts along the world −y axis.
//
// Equation of motion (1-DOF, scalar about z):
//
//   τ = (−m · g · a) · cos(q) + (Izz + m · a²) · q̈
//
// We collect the two identifiable linear combinations as
//
//   p1 = −m · g · a
//   p2 =  Izz + m · a²
//
// so that   τ = p1 · cos(q) + p2 · q̈.
//
// The regressor matrix for n samples is
//
//                | cos(q_1)   q̈_1 |
//   Y (n × 2) =  |    .         .   |
//                | cos(q_n)   q̈_n |
//
// and we solve the normal equations  (Yᵀ Y) p = Yᵀ τ  for p = [p1, p2]ᵀ
// with a closed-form 2×2 solve. Conditioning of the design matrix is
// reported from the closed-form eigenvalues of Yᵀ Y.
//
// Scope (what this solver DOES do):
//   - Identifies the linear combinations m·a and (Izz + m·a²) of a single
//     revolute planar link using ordinary least squares.
//   - Reports the residual r = τ − Y p, its L2 norm, RMS residual and the
//     sample count / degrees of freedom (n − 2).
//   - Warns when the data are ill-conditioned (constant q ⇒ cos(q) column
//     is rank-deficient ⇒ m·a is not observable; or fewer than 2 samples).
//   - Reports a numerical `mTimesA = −p1 / g` and `iEff = p2` together
//     with an identifiability note explaining that the three underlying
//     quantities (m, a, Izz) are not separately observable from a single
//     revolute joint torque measurement.
//
// Scope (what it DOES NOT do):
//   - Per-joint identification in a multi-DOF chain — those regressors
//     couple the joint contributions and require the RNE-based Newton-
//     Euler regressor (see the textbook Atkeson–An–Hollerbach survey).
//   - Friction, actuator inertia, sampling noise modelling.
//   - Bias identification on the torque sensor.
//   - Adaptive control / recursive estimation.
//
// References:
//   - Atkeson, An, Hollerbach, "Estimation of Inertial Parameters of
//     Manipulator Loads and Links", Int. J. Robotics Research 5(3),
//     1986. (Linear least-squares identification with the Newton–Euler
//     regressor.)
//   - Siciliano, Sciavicco, Villani, "Robotics" (Springer), §4.5–4.6
//     (RNE recursion and per-joint regressors), §7.6 (LSQ identification).
//   - Closed-form benchmark test cases in
//     tests/conkay-dynamics-parameter-id.test.js.

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const G = 9.80665;

/**
 * Solve (Yᵀ Y) p = (Yᵀ τ) using a closed-form 2×2 inverse.
 *
 * Yᵀ Y = [[a, b],
 *         [b, d]]
 *
 *   det      = a·d − b²
 *   p        = (1/det) · [[d, −b], [−b, a]] · Yᵀτ
 *
 * Returns { p:[p1,p2], det } or { singular: true } when det≈0.
 */
function solve2x2(ytY, yttau) {
  const a = ytY[0][0];
  const b = ytY[0][1];
  const d = ytY[1][1];
  const det = a * d - b * b;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return { singular: true };
  const inv00 = d / det;
  const inv01 = -b / det;
  const inv11 = a / det;
  const p1 = inv00 * yttau[0] + inv01 * yttau[1];
  const p2 = inv01 * yttau[0] + inv11 * yttau[1];
  return { p: [p1, p2], det };
}

/**
 * Closed-form eigenvalues of a 2×2 symmetric matrix [[a,b],[b,d]].
 * λ = (trace ± √(trace² − 4·det)) / 2.
 */
function eigvals2x2(a, b, d) {
  const tr = a + d;
  const det = a * d - b * b;
  const disc = tr * tr - 4 * det;
  const sq = disc > 0 ? Math.sqrt(disc) : 0;
  const lmax = (tr + sq) / 2;
  const lmin = (tr - sq) / 2;
  return { lmax, lmin, det };
}

/**
 * Identify the inertial parameters of a planar pendulum link.
 *
 * @param {Object} opts
 * @param {Array<{q:number, qdot?:number, qddot:number, tau:number}>} opts.samples
 *   An array of measured (q, q̈, τ) triples. `qdot` is accepted but unused.
 * @param {number} [opts.gravity=9.80665]
 *   Magnitude of gravitational acceleration (m/s²). Used only to back out
 *   `mTimesA = -p1 / gravity` from the identified parameter p1.
 * @param {number} [opts.residualTolerance=1e-6]
 *   Threshold for the RMS residual below which the fit is considered
 *   "ok"; otherwise the status becomes "warn".
 * @returns {Object}
 *   The structured result envelope described in the solver docstring.
 */
export function parameterId({ samples, gravity = 9.80665, residualTolerance = 1e-6 } = {}) {
  // ------------------------------------------------------------------
  // 1) Validate the sample array.
  // ------------------------------------------------------------------
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      status: "not_computed",
      reason: "samples required",
      identifiable: false,
      conditionNumber: 0,
      numSamples: 0,
      dof: 0,
      designMatrixShape: [0, 2],
      residual: [],
      residualNorm: 0,
      rmsResidual: 0,
    };
  }
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    if (!s || !Number.isFinite(s.q) || !Number.isFinite(s.qddot) || !Number.isFinite(s.tau)) {
      return {
        status: "not_computed",
        reason: `sample at index ${i} missing one of q/qddot/tau`,
        badIndex: i,
        identifiable: false,
        conditionNumber: 0,
        numSamples: samples.length,
        dof: Math.max(0, samples.length - 2),
        designMatrixShape: [samples.length, 2],
        residual: [],
        residualNorm: 0,
        rmsResidual: 0,
      };
    }
  }

  // ------------------------------------------------------------------
  // 2) Build Y (n × 2) and the τ vector.
  // ------------------------------------------------------------------
  const n = samples.length;
  // Y is stored row-major as a flat array (n × 2). Y[i*2 + 0] = cos(q_i),
  // Y[i*2 + 1] = qddot_i.
  const Y = new Array(n * 2);
  const tau = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const s = samples[i];
    Y[i * 2 + 0] = Math.cos(s.q);
    Y[i * 2 + 1] = s.qddot;
    tau[i] = s.tau;
  }

  // ------------------------------------------------------------------
  // 3) Form YᵀY (2×2) and Yᵀτ (length 2).
  // ------------------------------------------------------------------
  let a = 0, b = 0, d = 0;
  let yt0 = 0, yt1 = 0;
  for (let i = 0; i < n; i += 1) {
    const y0 = Y[i * 2 + 0];
    const y1 = Y[i * 2 + 1];
    const t = tau[i];
    a += y0 * y0;
    b += y0 * y1;
    d += y1 * y1;
    yt0 += y0 * t;
    yt1 += y1 * t;
  }
  const ytY = [[a, b], [b, d]];
  const yttau = [yt0, yt1];

  // Solve (YᵀY) p = Yᵀτ closed-form.
  const sol = solve2x2(ytY, yttau);
  let p = [0, 0];
  let solveSingular = false;
  if (sol.singular) {
    solveSingular = true;
    // p stays [0,0]; residual is then τ itself.
  } else {
    p = sol.p;
  }

  // ------------------------------------------------------------------
  // 4) Residual r = τ − Y p, residual norm, RMS residual.
  // ------------------------------------------------------------------
  const r = new Array(n);
  let rnorm2 = 0;
  for (let i = 0; i < n; i += 1) {
    const y0 = Y[i * 2 + 0];
    const y1 = Y[i * 2 + 1];
    const v = tau[i] - (y0 * p[0] + y1 * p[1]);
    r[i] = v;
    rnorm2 += v * v;
  }
  const residualNorm = Math.sqrt(rnorm2);
  const rmsResidual = n > 0 ? residualNorm / Math.sqrt(n) : 0;

  // ------------------------------------------------------------------
  // 5) Conditioning via the closed-form 2×2 eigenvalues of YᵀY.
  //    If λ_min ≤ 0 or κ > 1e10, the parameters are not separately
  //    observable from this data.
  // ------------------------------------------------------------------
  const eig = eigvals2x2(a, b, d);
  // Guaranteed non-negative by construction (YᵀY is symmetric PSD), but
  // floating-point round-off can flip the small eigenvalue slightly
  // below zero for rank-deficient matrices; clamp to 0 with a sign-aware
  // floor for the condition number.
  let lmax = eig.lmax;
  let lmin = eig.lmin;
  if (!Number.isFinite(lmax)) lmax = 0;
  if (!Number.isFinite(lmin)) lmin = 0;
  if (lmin < 0 && lmin > -1e-12) lmin = 0;
  let conditionNumber = lmax;
  if (lmin > 0) conditionNumber = lmax / lmin;
  else conditionNumber = Infinity;

  const COND_THRESHOLD = 1e10;
  const identifiable = !(solveSingular || lmin <= 0 || conditionNumber > COND_THRESHOLD || n < 2);

  let reason = null;
  if (solveSingular) {
    reason = "design matrix YᵀY is singular";
  } else if (n < 2) {
    reason = `fewer than 2 samples (n=${n}); the 2-parameter system cannot be solved`;
  } else if (lmin <= 0) {
    reason = "YᵀY has a non-positive eigenvalue — design matrix is rank-deficient";
  } else if (conditionNumber > COND_THRESHOLD) {
    reason = `YᵀY conditioning κ=${conditionNumber.toExponential(3)} exceeds threshold ${COND_THRESHOLD.toExponential(0)}`;
  }

  // ------------------------------------------------------------------
  // 6) Recovered combinations and identifiability note.
  // ------------------------------------------------------------------
  const recoveredCombinations = {
    mTimesA: -p[0] / gravity,
    iEff: p[1],
  };
  const identifiability = "A single revolute joint identifies only the two combinations m·a and (Izz + m·a²); the three underlying quantities m, a, and Izz cannot be obtained separately from torque measurements at one joint alone — additional joints, motion in a second axis, or a torque-offset measurement are required.";

  // ------------------------------------------------------------------
  // 7) Status: "ok" | "warn" | "not_computed".
  // ------------------------------------------------------------------
  let status;
  if (!identifiable) {
    status = "warn";
  } else if (Number.isFinite(rmsResidual) && rmsResidual <= residualTolerance) {
    status = "ok";
  } else {
    status = "warn";
    reason = `rmsResidual=${rmsResidual.toExponential(3)} exceeds tolerance ${residualTolerance.toExponential(0)}`;
  }

  // Sanity: ensure every numeric output is finite.
  const finite = (v) => (Number.isFinite(v) ? v : 0);

  return {
    status,
    reason,
    parameters: { p1: finite(p[0]), p2: finite(p[1]) },
    recoveredCombinations: {
      mTimesA: finite(recoveredCombinations.mTimesA),
      iEff: finite(recoveredCombinations.iEff),
    },
    identifiability,
    identifiable,
    conditionNumber: finite(conditionNumber),
    residual: r.map(finite),
    residualNorm: finite(residualNorm),
    rmsResidual: finite(rmsResidual),
    numSamples: n,
    dof: Math.max(0, n - 2),
    designMatrixShape: [n, 2],
  };
}

registerSolver({
  id: "dynamics.parameter-id",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "dynamics.lsq-parameter-identification",
  fidelity: 1,
    // Graph-native: runs when any node carries props.dynamics.parameterId.
  // The props subtree is passed straight through to parameterId.
  targets: graphTargets("dynamics.parameterId"),
  run: graphRunner("dynamics.parameterId", (ctx, id, props) => envelope(parameterId(props))),});
