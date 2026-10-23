// server/lib/conkay/physics/solvers/stability-push-recovery.js
//
// stability.push-recovery — disturbance-recovery feasibility for a biped.
//
// Linear Inverted Pendulum Model (LIPM) cascade:
//   1. Compute the Instantaneous Capture Point (ICP) BEFORE the push.
//      icpBefore = p_cg + v_cg / ω₀,  ω₀ = √(g / z_c).
//   2. Apply the push — horizontal impulse at CoM height shifts CoM
//      velocity: Δv = pushImpulseN·s / mass.
//   3. Compute the ICP AFTER the push. Under ZMP control the ICP
//      converges exponentially toward the support center
//      (foot-center regulation), so the required step length is
//      the distance from the current CoM to the new ICP.
//   4. Step feasibility: required step ≤ maxStepLengthM.
//   5. Friction feasibility: μ_required = |v_new| / (g·T_recover).
//   6. Sample the ICP decay over recoveryTimeS for trajectory output.
//
// Inputs:
//   supportPatch:     { x, y, halfX, halfY }  — stance foot support rectangle
//   comPos:           [x, y, z]                — current CoM
//   comVel:           [vx, vy, vz]             — current CoM velocity
//   comHeight:        scalar (m)               — LIPM constant CoM height
//   comMass:          scalar (kg)              — required
//   pushImpulseNs:    scalar (N·s)             — horizontal impulse at CoM
//   recoveryTimeS:    scalar (s, default 0.7)  — recovery step placement time
//   maxStepLengthM:   scalar (m, default 0.35)
//   sampleSteps:      int (default 40)
//   frictionCoefficient: scalar (default 0.6)
//
// Output:
//   { status, icpBefore, icpAfter, stepDistanceM, requiredStepM,
//     withinStepLimit, frictionOk, muRequired, muAvailable,
//     trajectory: [{ t, icp:[x,y] }], comMass, pushImpulseNs }

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const G = 9.80665;

function isFinite2(a) {
  return Number.isFinite(a[0]) && Number.isFinite(a[1]);
}

function safeHypot(a, b) {
  const ax = Number.isFinite(a) ? a : 0;
  const bx = Number.isFinite(b) ? b : 0;
  return Math.sqrt(ax * ax + bx * bx);
}

/**
 * Evaluate push-recovery feasibility for a biped under a horizontal impulse.
 * Returns { status, ... } with the full trajectory and feasibility margins.
 */
export function pushRecovery({
  supportPatch = { x: 0, y: 0, halfX: 0.12, halfY: 0.07 },
  comPos = [0, 0, 1.0],
  comVel = [0, 0, 0],
  comHeight = 1.0,
  comMass,
  pushImpulseNs = 0,
  recoveryTimeS = 0.7,
  maxStepLengthM = 0.35,
  sampleSteps = 40,
  frictionCoefficient = 0.6,
} = {}) {
  // Guard: comMass is required (impulse ⇒ velocity ⇒ force computation).
  if (comMass == null || !Number.isFinite(comMass) || comMass <= 0) {
    return {
      status: "not_computed",
      reason: "comMass required",
      supportPatch, comPos, comVel, comHeight,
      pushImpulseNs, recoveryTimeS, maxStepLengthM, sampleSteps,
    };
  }

  // Guard: comHeight must be positive for ω₀ and division.
  if (!Number.isFinite(comHeight) || comHeight <= 0) {
    return {
      status: "not_computed",
      reason: "comHeight must be positive",
      supportPatch, comPos, comVel, comHeight, comMass,
      pushImpulseNs, recoveryTimeS, maxStepLengthM, sampleSteps,
    };
  }

  // Coerce numeric inputs.
  const cp = [
    Number.isFinite(comPos[0]) ? comPos[0] : 0,
    Number.isFinite(comPos[1]) ? comPos[1] : 0,
    Number.isFinite(comPos[2]) ? comPos[2] : comHeight,
  ];
  const cv = [
    Number.isFinite(comVel[0]) ? comVel[0] : 0,
    Number.isFinite(comVel[1]) ? comVel[1] : 0,
    Number.isFinite(comVel[2]) ? comVel[2] : 0,
  ];
  const J = Number.isFinite(pushImpulseNs) ? pushImpulseNs : 0;
  const T = Number.isFinite(recoveryTimeS) && recoveryTimeS > 0 ? recoveryTimeS : 0.7;
  const Lmax = Number.isFinite(maxStepLengthM) ? maxStepLengthM : 0.35;
  const N = Number.isInteger(sampleSteps) && sampleSteps > 0 ? sampleSteps : 40;
  const muAvail = Number.isFinite(frictionCoefficient) && frictionCoefficient > 0 ? frictionCoefficient : 0.6;

  const sp = {
    x: Number.isFinite(supportPatch?.x) ? supportPatch.x : 0,
    y: Number.isFinite(supportPatch?.y) ? supportPatch.y : 0,
    halfX: Number.isFinite(supportPatch?.halfX) && supportPatch.halfX > 0 ? supportPatch.halfX : 0.12,
    halfY: Number.isFinite(supportPatch?.halfY) && supportPatch.halfY > 0 ? supportPatch.halfY : 0.07,
  };

  // ω₀ = √(g / z_c)
  const w = Math.sqrt(G / comHeight);

  // ICP BEFORE the push.
  const icpBefore = [
    cp[0] + cv[0] / w,
    cp[1] + cv[1] / w,
  ];

  // Apply the push — horizontal impulse changes CoM velocity (x-component only).
  const newVel = [cv[0] + J / comMass, cv[1], cv[2]];

  // ICP AFTER the push.
  const icpAfter = [
    cp[0] + newVel[0] / w,
    cp[1] + newVel[1] / w,
  ];

  // Required step = distance from current CoM to the new ICP
  // (under foot-center ZMP regulation the CoM has to land on the new ICP).
  const stepDistance = safeHypot(icpAfter[0] - cp[0], icpAfter[1] - cp[1]);

  // Step-length feasibility.
  const withinStepLimit = stepDistance <= Lmax + 1e-12;

  // Friction feasibility — required horizontal GRF to decelerate over T.
  //   F_req = m·|v_new| / T
  //   μ_required = F_req / (m·g) = |v_new| / (g·T)
  const speedNew = safeHypot(newVel[0], newVel[1]);
  const muRequired = G * T > 0 ? speedNew / (G * T) : Infinity;
  const frictionOk = Number.isFinite(muRequired) && muRequired <= muAvail + 1e-12;

  // Sample the ICP decay under ZMP control at the support center:
  //   icp(t) = supportCenter + (icpAfter - supportCenter) · exp(-ω·t)
  // The support center always satisfies inSupport (its own center is inside
  // any non-degenerate rectangle), but we record the flag for completeness.
  const supportCenter = [sp.x, sp.y];
  const trajectory = [];
  const dt = T / N;
  let allIcpInSupport = true;
  for (let k = 0; k <= N; k += 1) {
    const t = k * dt;
    const decay = Math.exp(-w * t);
    const ix = supportCenter[0] + (icpAfter[0] - supportCenter[0]) * decay;
    const iy = supportCenter[1] + (icpAfter[1] - supportCenter[1]) * decay;
    const offX = ix - sp.x;
    const offY = iy - sp.y;
    const inX = Math.abs(offX) <= sp.halfX + 1e-9;
    const inY = Math.abs(offY) <= sp.halfY + 1e-9;
    if (!(inX && inY)) allIcpInSupport = false;
    trajectory.push({ t, icp: [ix, iy], inSupport: inX && inY });
  }

  // Final status — step first, then friction (matches the spec ordering).
  let status;
  let reason;
  if (!withinStepLimit) {
    status = "fail";
    reason = "required recovery step exceeds max step length";
  } else if (!frictionOk) {
    status = "fail";
    reason = "required friction exceeds available";
  } else {
    status = "ok";
  }

  // Guard final numerics — every number in the receipt must be finite.
  const icpBeforeSafe = isFinite2(icpBefore) ? icpBefore : [0, 0];
  const icpAfterSafe = isFinite2(icpAfter) ? icpAfter : [0, 0];
  const stepSafe = Number.isFinite(stepDistance) ? stepDistance : 0;
  const muReqSafe = Number.isFinite(muRequired) ? muRequired : Infinity;

  return {
    status,
    reason,
    icpBefore: icpBeforeSafe,
    icpAfter: icpAfterSafe,
    stepDistanceM: stepSafe,
    requiredStepM: Lmax,
    withinStepLimit,
    frictionOk,
    muRequired: muReqSafe,
    muAvailable: muAvail,
    trajectory,
    zmpInSupportThroughout: allIcpInSupport,
    comMass,
    pushImpulseNs: J,
    diagnostics: {
      omega0: w,
      comHeight,
      comPos: cp.slice(),
      comVel: cv.slice(),
      newVel: newVel.slice(),
      recoveryTimeS: T,
      sampleSteps: N,
      frictionCoefficient: muAvail,
      supportCenter,
    },
  };
}

registerSolver({
  id: "stability.push-recovery",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "stability.lipm-push-recovery",
  fidelity: 1,
    // Graph-native: runs when any node carries props.stability.pushRecovery.
  // The props subtree is passed straight through to pushRecovery.
  targets: graphTargets("stability.pushRecovery"),
  run: graphRunner("stability.pushRecovery", (ctx, id, props) => envelope(pushRecovery(props))),});
