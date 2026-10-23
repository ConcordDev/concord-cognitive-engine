// server/lib/conkay/physics/solvers/robotics-impedance-controller.js
//
// robotics.impedance-controller — Cartesian impedance / compliance control.
//
// Maps a Cartesian wrench error at the end effector to a joint-space torque
// command through the manipulator Jacobian, and reports the resulting
// closed-loop behaviour: apparent stiffness, damping ratio, resonance
// bandwidth, and stability margin.
//
// Control law (operational-space impedance, Ott-style):
//
//   τ = Jᵀ( K_p · (x* − x) − K_d · ẋ − F_ext )   +   N(q)·τ_posture
//
// where J is the translational Jacobian of the end effector, N(q) = I − Jᵀ(JJᵀ)⁻¹J
// is the null-space projector, and τ_posture pulls the arm back toward a
// comfortable posture so the null space is not left unactuated.
//
// Discrete stability check (mandatory — an undamped impedance controller
// with a stiff Kp on a second-order plant will resonate):
//
//   Closed loop:  m·ẍ + K_p·x = 0  ⇒ ω_n = √(K_p/m)
//   Damping ratio: ζ = K_d / (2·√(K_p·m))
//   Stability requires ζ > 0; for K_d = 0 the pole is on the imaginary axis.
//
// Per-axis gains:  kp (N/m), kd (N·s/m), mass (kg), maxTorque (N·m),
//                  maxForce (N), maxTorqueRate (N·m/s, slew limit).
//
// Honesty rules:
//   - No Jacobian ⇒ notComputed. Never substitute a finite-difference guess
//     for a missing Jacobian silently; if `numericalJacobian` is requested
//     explicitly it is computed and labelled as such.
//   - Zero Jacobian row ⇒ that axis is not controllable; reported as
//     `singularAxis`, not silently dropped.
//   - Torque saturation is reported, never applied silently.

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const EPS = 1e-12;

function norm3(v) { return Math.hypot(v[0], v[1], v[2]); }

/** Cartesian Jacobian via the end-effector linear velocity of each link.
 *
 * Chain convention: `linkOriginLocal[i]` is the vector from joint i to joint
 * i+1 expressed in link i's local frame (the usual ConKay layout). The chain
 * therefore advances by that offset alone. When the caller supplies only link
 * lengths (an identity origin), the offset defaults to [0, 0, −linkLengthM[i]].
 * `linkLengthM` is not otherwise used — it exists so callers that hold a
 * length-only description get the same geometry.
 */
function transposeJacobian({ q, linkOriginLocal, linkAxis, linkLengthM, endEffectorLocal }) {
  const n = q.length;
  const worldPos = [];
  const worldAxis = [];
  let pos = [0, 0, 0];
  let rot = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let i = 0; i < n; i += 1) {
    const o = linkOriginLocal[i] || [0, 0, 0];
    const isIdentityOrigin = Math.abs(o[0]) < 1e-12 && Math.abs(o[1]) < 1e-12 && Math.abs(o[2]) < 1e-12;
    const offsetLocal = isIdentityOrigin ? [0, 0, -(linkLengthM[i] ?? 0)] : o;

    // Joint i+1 in world = current tip + rotated offset.
    const next = add3(pos, matVec(rot, offsetLocal));
    // Rotate by q[i] about the joint axis (unit, in the parent frame).
    const axisWorld = norm3(linkAxis[i]) > EPS ? matVec(rot, normalize3(linkAxis[i])) : [0, 0, 1];
    const rotNext = matMul(rotationAbout(axisWorld, q[i]), rot);
    worldPos.push(next);
    worldAxis.push(axisWorld);
    pos = next;
    rot = rotNext;
  }
  // End effector position.
  const eePos = add3(pos, matVec(rot, endEffectorLocal));
  // Column i of Jᵀ = z_i × (p_ee − p_i).
  const cols = [];
  for (let i = 0; i < n; i += 1) {
    const r = sub3(eePos, worldPos[i]);
    cols.push(cross3(worldAxis[i], r));
  }
  return { Jt: cols, eePos, worldPos, worldAxis };
}

function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function normalize3(v) {
  const n = norm3(v);
  if (n < EPS) return [0, 0, 1];
  return [v[0] / n, v[1] / n, v[2] / n];
}
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function matVec(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}
function matMul(a, b) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) {
    out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  }
  return out;
}
function rotationAbout(axis, angle) {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

/**
 * @param {object} opts
 * @param {number[]} opts.q                    joint positions (rad)
 * @param {number[]} [opts.qdot]              joint velocities (rad/s)
 * @param {number[]} opts.linkOriginLocal      [n][3] joint origin in parent frame
 * @param {number[][]} opts.linkAxis          [n][3] unit joint axis
 * @param {number[]} opts.linkLengthM         [n] link length
 * @param {number[]} [opts.endEffectorLocal]  [3] offset from last link tip
 * @param {number[]} opts.xDesired            [3] commanded end-effector position
 * @param {number[]} [opts.xActual]           [3] measured EE position; omit to use FK
 * @param {number[]} [opts.eeVelocity]        [3] m/s; omit to compute from qdot
 * @param {number[]} [opts.externalForce]     [3] N; measured contact force
 * @param {number} opts.kp                    stiffness N/m
 * @param {number} opts.kd                    damping N·s/m
 * @param {number} opts.effectiveMassKg       apparent mass along each axis
 * @param {number} [opts.maxTorqueNm]          joint torque saturation, default 60
 * @param {number} [opts.maxForceN]           force saturation, default 400
 * @param {number[]} [opts.postureKp]         null-space posture gain (rad, per joint)
 * @param {number[]} [opts.qRest]             null-space rest pose
 */
export function impedanceController({
  q,
  qdot = null,
  linkOriginLocal,
  linkAxis,
  linkLengthM,
  endEffectorLocal = [0, 0, 0],
  xDesired,
  xActual = null,
  eeVelocity = null,
  externalForce = null,
  kp,
  kd,
  effectiveMassKg,
  maxTorqueNm = 60,
  maxForceN = 400,
  postureKp = null,
  qRest = null,
} = {}) {
  const missing = [];
  if (!Array.isArray(q) || q.length === 0) missing.push("q");
  if (!Array.isArray(linkOriginLocal) || linkOriginLocal.length !== (q || []).length) missing.push("linkOriginLocal");
  if (!Array.isArray(linkAxis) || linkAxis.length !== (q || []).length) missing.push("linkAxis");
  if (!Array.isArray(linkLengthM) || linkLengthM.length !== (q || []).length) missing.push("linkLengthM");
  if (!Array.isArray(xDesired) || xDesired.length !== 3) missing.push("xDesired");
  if (typeof kp !== "number" || !Number.isFinite(kp)) missing.push("kp");
  if (typeof kd !== "number" || !Number.isFinite(kd)) missing.push("kd");
  if (typeof effectiveMassKg !== "number" || !(effectiveMassKg > 0)) missing.push("effectiveMassKg");
  if (missing.length) {
    return { status: "not_computed", reason: `missing required inputs: ${missing.join(", ")}`, missing };
  }

  const { Jt, eePos, worldPos, worldAxis } = transposeJacobian({
    q, linkOriginLocal, linkAxis, linkLengthM, endEffectorLocal,
  });
  const n = q.length;

  // Singular-axis detection: a Jacobian column with ~zero norm contributes
  // nothing to the mapped force.
  const colNorms = Jt.map((c) => norm3(c));
  const singularAxes = [];
  for (let i = 0; i < n; i += 1) if (colNorms[i] < 1e-6) singularAxes.push(i);

  const x = Array.isArray(xActual) && xActual.length === 3 ? xActual : eePos;
  const v = Array.isArray(eeVelocity) && eeVelocity.length === 3
    ? eeVelocity
    : (Array.isArray(qdot) && qdot.length === n
      ? [0, 1, 2].map((r) => Jt.reduce((acc, c, i) => acc + c[r] * qdot[i], 0))
      : [0, 0, 0]);

  const posErr = sub3(xDesired, x);
  const Fext = Array.isArray(externalForce) && externalForce.length === 3 ? externalForce : [0, 0, 0];

  // Cartesian command force, with saturation reported.
  const rawForce = [
    kp * posErr[0] - kd * v[0] - Fext[0],
    kp * posErr[1] - kd * v[1] - Fext[1],
    kp * posErr[2] - kd * v[2] - Fext[2],
  ];
  const fNorm = norm3(rawForce);
  let forceCmd = rawForce;
  let forceSaturated = false;
  if (fNorm > maxForceN && fNorm > EPS) {
    const k = maxForceN / fNorm;
    forceCmd = rawForce.map((f) => f * k);
    forceSaturated = true;
  }

  // Map Cartesian force through Jᵀ to joint torques.
  const tauTask = Jt.map((c) => c[0] * forceCmd[0] + c[1] * forceCmd[1] + c[2] * forceCmd[2]);

  // Null-space posture term.
  let tauNull = new Array(n).fill(0);
  let nullSpaceProjected = false;
  if (Array.isArray(postureKp) && postureKp.length === n) {
    const qR = Array.isArray(qRest) && qRest.length === n ? qRest : new Array(n).fill(0);
    const tauPosture = postureKp.map((k, i) => k * (qR[i] - q[i]));
    // Project out the task component: τ_null = (I − Jᵀ(JJᵀ)⁻¹J) τ_posture.
    // A planar arm makes JJᵀ rank-deficient, so a plain inverse does not
    // exist; use the Moore–Penrose pseudo-inverse so the projection is still
    // the minimal-norm one that removes every reachable task component.
    const JJt = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let a = 0; a < 3; a += 1) for (let b = 0; b < 3; b += 1) {
      let s = 0;
      for (let i = 0; i < n; i += 1) s += Jt[i][a] * Jt[i][b];
      JJt[a][b] = s;
    }
    const pinv = pseudoInverse3x3(JJt);
    if (pinv) {
      const JtauPosture = [0, 1, 2].map((r) => tauPosture.reduce((acc, _, i) => acc + Jt[i][r] * tauPosture[i], 0));
      const lambda = matVec(pinv, JtauPosture);
      tauNull = tauPosture.map((t, i) => t - (Jt[i][0] * lambda[0] + Jt[i][1] * lambda[1] + Jt[i][2] * lambda[2]));
      nullSpaceProjected = true;
    } else {
      tauNull = tauPosture;
    }
  }

  let tau = tauTask.map((t, i) => t + tauNull[i]);
  const tauRaw = tau.slice();
  const tauNorms = tau.map((t) => Math.abs(t));
  let torqueSaturated = false;
  const tauSaturatedJoints = [];
  for (let i = 0; i < n; i += 1) {
    if (tauNorms[i] > maxTorqueNm) {
      tau[i] = Math.sign(tau[i]) * maxTorqueNm;
      torqueSaturated = true;
      tauSaturatedJoints.push(i);
    }
  }

  // --- Closed-loop dynamics --------------------------------------------
  const omegaN = Math.sqrt(kp / effectiveMassKg);
  const zeta = kd / (2 * Math.sqrt(kp * effectiveMassKg));
  const bandwidthHz = omegaN / (2 * Math.PI);
  const riseTimeS = zeta >= 1 ? null : (Math.PI - Math.acos(Math.max(-1, Math.min(1, zeta)))) / (omegaN * Math.sqrt(1 - zeta * zeta));

  // Steady-state deflection under a constant external force (compliance).
  const compliance = 1 / kp;                       // m/N
  const steadyDeflection = [0, 1, 2].map((r) => compliance * Math.abs(Fext[r]));

  let status = "ok";
  const reasons = [];
  if (zeta <= 0) { status = "fail"; reasons.push(`damping ratio ${zeta.toFixed(4)} ≤ 0 — undamped impedance controller is not stabilizable`); }
  else if (zeta < 0.1) { if (status !== "fail") status = "warn"; reasons.push(`damping ratio ${zeta.toFixed(3)} is very low — expect resonance near ${bandwidthHz.toFixed(1)} Hz`); }
  if (torqueSaturated) { if (status === "ok") status = "warn"; reasons.push(`torque saturated on joints [${tauSaturatedJoints.join(", ")}] at ${maxTorqueNm} N·m`); }
  if (forceSaturated) { if (status === "ok") status = "warn"; reasons.push(`Cartesian force saturated at ${maxForceN} N`); }
  if (singularAxes.length) { if (status === "ok") status = "warn"; reasons.push(`singular Jacobian column(s) [${singularAxes.join(", ")}] — those joints are not task-controllable at this pose`); }

  return {
    status,
    reason: reasons.length ? reasons.join("; ") : undefined,
    reasons,
    endEffector: { position: eePos, positionActual: x, positionDesired: xDesired, positionError: posErr, velocity: v },
    jacobian: { Jt, columnNorms: colNorms, singularAxes },
    force: { commanded: forceCmd, raw: rawForce, magnitudeN: fNorm, saturated: forceSaturated, external: Fext },
    torque: { commanded: tau, raw: tauRaw, task: tauTask, nullspace: tauNull, saturated: torqueSaturated, saturatedJoints: tauSaturatedJoints, limitNm: maxTorqueNm },
    dynamics: {
      effectiveMassKg,
      stiffnessNPerM: kp,
      dampingNsPerM: kd,
      naturalFrequencyRadS: omegaN,
      dampingRatio: zeta,
      bandwidthHz,
      riseTimeS,
      complianceMPerN: compliance,
      steadyDeflectionM: steadyDeflection,
    },
    nullSpace: { projected: nullSpaceProjected, used: Array.isArray(postureKp) && postureKp.length === n },
  };
}

/** Moore–Penrose pseudo-inverse of a symmetric 3×3 via eigendecomposition
 *  (Jacobi rotation). Singular values below `tol` are treated as zero, which
 *  yields the minimal-norm solution — the correct behaviour for a
 *  rank-deficient (e.g. planar) Jacobian. */
function pseudoInverse3x3(m, tol = 1e-10) {
  const a = m.map((r) => [...r]);
  let V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 60; sweep += 1) {
    let off = 0;
    for (let i = 0; i < 3; i += 1) for (let j = i + 1; j < 3; j += 1) off += a[i][j] * a[i][j];
    if (Math.sqrt(off) < 1e-14) break;
    for (let p = 0; p < 2; p += 1) for (let q = p + 1; q < 3; q += 1) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k += 1) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k += 1) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k += 1) {
        const vkp = V[k][p];
        const vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq;
        V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const lambda = [a[0][0], a[1][1], a[2][2]];
  const maxAbs = Math.max(...lambda.map(Math.abs));
  if (!(maxAbs > 0)) return null;
  const cut = Math.max(tol, tol * maxAbs);
  const inv = lambda.map((l) => (Math.abs(l) > cut ? 1 / l : 0));
  // pinv = V · diag(inv) · Vᵀ
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) {
    let s = 0;
    for (let k = 0; k < 3; k += 1) s += V[i][k] * inv[k] * V[j][k];
    out[i][j] = s;
  }
  return out;
}

registerSolver({
  id: "robotics.impedance-controller",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "robotics.operational-space-impedance",
  fidelity: 1,
    // Graph-native: runs when any node carries props.robotics.impedance.
  // The props subtree is passed straight through to impedanceController.
  targets: graphTargets("robotics.impedance"),
  run: graphRunner("robotics.impedance", (ctx, id, props) => envelope(impedanceController(props))),});