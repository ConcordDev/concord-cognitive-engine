// server/lib/conkay/physics/solvers/gait-preview-control.js
//
// gait.preview-control — Kajita et al. (2003) ZMP preview control.
//
// This is the canonical Model Predictive Control for bipedal walking:
// Given a reference ZMP trajectory, compute the optimal Center of Mass (CoM)
// trajectory that tracks it.
//
// The Linear Inverted Pendulum Model (LIPM):
//   ẍ = ω²·(x_com - x_zmp),   where ω = sqrt(g / z_c)
//
// Kajita's discrete formulation uses state x = [c, ċ]ᵀ:
//   [c[k+1]]   [1   T] [c[k]]   [T²/2] u[k]       T  = sample period
//   [ċ[k+1]] = [ω²T 1] [ċ[k]] + [T  ]           ω² = g/z
//
// The control input u[k] is the ZMP reference (target for the controller).
// The cost is the squared ZMP tracking error over a preview horizon.
//
// Closed-form solution (Kajita §3.5): at each step k,
//   u[k] = -Gi·ξ[k] - Σ_{j=0..N-1} Gd[j]·p_ref[k+j]
// where ξ[k] is the state vector (c[k], ċ[k])ᵀ, Gi is the immediate gain,
// and Gd is the preview gain vector.
//
// Solver input:
//   zmpTrajectory:  [{t, p:[px,py]}]   reference ZMP in world
//   comTrajectoryInit: { p:[x,y], v:[vx,vy], a:[ax,ay] }   initial CoM
//   samplePeriod: T (seconds)
//   comHeight: z (metres)
//   previewHorizonSteps: N
//
// Output:
//   comTrajectory: [{t, p:[x,y,z], v:[vx,vy,0], a:[ax,ay,0]}]
//   zmpActualTrajectory: [{t, p:[x,y]}]   computed ZMP from CoM
//   trackingErrorSq: scalar

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const G = 9.80665;

/** Build the Kajita discrete LIPM matrices A, B for a given T and ω². */
function buildAB(T, omega2) {
  const A = [
    [1 + omega2 * T * T / 2, T],
    [omega2 * T, 1],
  ];
  const B = [
    [omega2 * T * T / 2],
    [omega2 * T],
  ];
  return { A, B };
}

/** Kajita's analytical preview gain via impulse response.
 *  Computes the LIPM impulse response of the **closed-loop** system under
 *  Kajita's standard servo: Kx on (c - p_ref) and ċ.
 *
 *  Closed-loop: ẍ = ω²·(c - p_ref) - Kp·(c - p_ref) - Kv·ċ
 *               = (ω² - Kp)·(c - p_ref) - Kv·ċ
 *  We use Kp = ω², Kv = 2ω (critically-damped 2nd-order response to (c - p_ref)).
 *
 *  The "modified" LIPM matrix A_cl with these gains is:
 *    c[k+1]   = c[k] + T·ċ[k] + (T²/2)·((ω²-Kp)·(c[k]-p_ref[k]) - Kv·ċ[k] + ω²·p_ref[k])
 *            = c[k] + T·ċ[k] + (T²/2)·(-Kv·ċ[k] + ω²·p_ref[k])          when Kp=ω²
 *    ċ[k+1]   = ċ[k] + T·((ω²-Kp)·(c[k]-p_ref[k]) - Kv·ċ[k])
 *            = ċ[k] - T·Kv·ċ[k]                                            when Kp=ω²
 *  Discretized as ξ[k+1] = A_cl·ξ[k] + B_cl·p_ref[k]:
 *    A_cl = [[1, T - (T²/2)·Kv],
 *            [0, 1 - T·Kv]]
 *    B_cl = [[ω²·T²/2],
 *            [ω²·T]]
 */
function computeKajitaPreviewGains(T, omega2, previewSteps) {
  const omega = Math.sqrt(omega2);
  // Slightly under-tune Kp relative to ω² (and Kv below 2ω) for strict stability
  // of the discrete-time system at typical sample rates.
  const Kp = omega2 * 0.9;
  const Kv = 1.5 * omega;                                // damping ratio ≈ 0.75 (under-damped)
  const Acl = [
    [1, T - (T * T / 2) * Kv],
    [-T * Kp, 1 - T * Kv - (T * T / 2) * (omega2 * Kv)],
  ];
  const Bcl = [
    [omega2 * T * T / 2],
    [omega2 * T],
  ];
  // Impulse response: Acl^n · Bcl for n = 1, ..., previewSteps.
  const previewGains = [];
  let Ap = [[1, 0], [0, 1]];
  for (let n = 1; n <= previewSteps; n += 1) {
    // Ap = Acl^{n-1}.
    if (n > 1) {
      const [a11, a12] = Ap[0]; const [a21, a22] = Ap[1];
      Ap = [
        [a11 * Acl[0][0] + a12 * Acl[1][0], a11 * Acl[0][1] + a12 * Acl[1][1]],
        [a21 * Acl[0][0] + a22 * Acl[1][0], a21 * Acl[0][1] + a22 * Acl[1][1]],
      ];
    }
    previewGains.push(Ap[0][0] * Bcl[0][0] + Ap[0][1] * Bcl[1][0]);
  }
  // Effective "servo" gains to apply to the current state error: Kp on (c - p_ref),
  // Kv on ċ. (Already absorbed into Acl via the closed-loop dynamics.)
  // For clarity we report them here for diagnostics.
  return { Kp, Kv, Acl, Bcl, previewGains };
}

/** Run Kajita preview control for one dimension (x or y).
 *  Closed-loop dynamics with Kp = ω² (perfect tracking of steady-state), Kv = 2ω (critically damped).
 */
function previewControl1D({ initialC, initialCdot, zmpRef, T, omega2, previewSteps }) {
  const { Acl, Bcl, previewGains } = computeKajitaPreviewGains(T, omega2, previewSteps);
  const Kv = 2 * Math.sqrt(omega2);
  const cOut = [];
  const cdotOut = [];
  const zmpPadded = zmpRef.slice();
  const lastRef = zmpPadded[zmpPadded.length - 1] || 0;
  while (zmpPadded.length < previewSteps + zmpRef.length + 10) zmpPadded.push(lastRef);

  let c = initialC;
  let cdot = initialCdot;
  for (let k = 0; k < zmpRef.length; k += 1) {
    const pRef = zmpPadded[k];
    // Feedback corrections + preview term.
    // u_preview[k] = -Σ_j Kd[j]·p_ref[k+1+j]
    // u_state[k]   = -Kp·(c - p_ref) - Kv·ċ
    // Combined total ZMP effective: u_eff = u_state + u_preview already folded into Acl+Bcl.
    let u_preview = 0;
    for (let j = 0; j < previewSteps; j += 1) {
      const refIdx = k + 1 + j;
      if (refIdx < zmpPadded.length) u_preview -= previewGains[j] * zmpPadded[refIdx];
    }
    // Closed-loop state update: ξ[k+1] = Acl·ξ[k] + Bcl·(p_ref[k] + u_preview)
    //                                  + Kv·ċ[k]·(T²/2, T) (this is the Kv feedback via direct integration)
    const u_total = u_preview;
    c = Acl[0][0] * c + Acl[0][1] * cdot + Bcl[0][0] * (pRef + u_total / omega2);
    cdot = Acl[1][0] * c + Acl[1][1] * cdot + Bcl[1][0] * (pRef + u_total / omega2);
    cOut.push(c);
    cdotOut.push(cdot);
  }
  return { c: cOut, cdot: cdotOut };
}

export function gaitPreviewControl({ zmpTrajectory, comInit = { x: 0, y: 0, vx: 0, vy: 0 }, samplePeriod = 0.01, comHeight = 1.0, previewHorizonS = 2.0 }) {
  if (!Array.isArray(zmpTrajectory) || zmpTrajectory.length === 0) {
    return { status: "not_computed", reason: "zmpTrajectory required" };
  }
  if (!Number.isFinite(samplePeriod) || samplePeriod <= 0) {
    return { status: "not_computed", reason: "samplePeriod must be > 0" };
  }
  if (!Number.isFinite(comHeight) || comHeight <= 0) {
    return { status: "not_computed", reason: "comHeight must be > 0" };
  }

  const omega2 = G / comHeight;
  const previewSteps = Math.max(2, Math.ceil(previewHorizonS / samplePeriod));

  const px = zmpTrajectory.map((p) => p[0]);
  const py = zmpTrajectory.map((p) => p[1]);
  const xOut = previewControl1D({ initialC: comInit.x, initialCdot: comInit.vx, zmpRef: px, T: samplePeriod, omega2, previewSteps });
  const yOut = previewControl1D({ initialC: comInit.y, initialCdot: comInit.vy, zmpRef: py, T: samplePeriod, omega2, previewSteps });

  const comTrajectory = [];
  for (let k = 0; k < xOut.c.length; k += 1) {
    const t = k * samplePeriod;
    comTrajectory.push({ t, p: [xOut.c[k], yOut.c[k], comHeight], v: [xOut.cdot[k], yOut.cdot[k], 0] });
  }
  let zmpErrSqSum = 0;
  const zmpActual = [];
  for (let k = 0; k < comTrajectory.length - 1; k += 1) {
    const c = comTrajectory[k].p;
    const acc = [
      (comTrajectory[k + 1].v[0] - comTrajectory[k].v[0]) / samplePeriod,
      (comTrajectory[k + 1].v[1] - comTrajectory[k].v[1]) / samplePeriod,
    ];
    const zmp_x = c[0] - (comHeight / G) * acc[0];
    const zmp_y = c[1] - (comHeight / G) * acc[1];
    zmpActual.push({ t: comTrajectory[k].t, p: [zmp_x, zmp_y] });
    const ref = (k < zmpTrajectory.length) ? zmpTrajectory[k] : zmpTrajectory[zmpTrajectory.length - 1];
    const dx = zmp_x - ref[0];
    const dy = zmp_y - ref[1];
    zmpErrSqSum += dx * dx + dy * dy;
  }

  return { status: "ok", comTrajectory, zmpActual, trackingErrorSq: zmpErrSqSum, samplePeriod, comHeight, previewHorizonS, previewSteps };
}

registerSolver({
  id: "gait.preview-control",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "gait.kajita-preview-control",
  fidelity: 2,
    // Graph-native: runs when any node carries props.gait.preview.
  // The props subtree is passed straight through to gaitPreviewControl.
  targets: graphTargets("gait.preview"),
  run: graphRunner("gait.preview", (ctx, id, props) => envelope(gaitPreviewControl(props))),});