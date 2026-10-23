// server/lib/conkay/physics/solvers/stability-pressure-distribution.js
//
// stability.pressure-distribution — foot pressure distribution, CoP and
// ankle torque for a single rigid foot in static/dynamic stance.
//
// Inputs:
//   footPatch:          { x, y, halfX, halfY } — rectangular foot contact patch (m)
//   totalNormalForceN:  scalar — total vertical ground-reaction force (N)
//   comPos:             [x, y, z] — CoM position (world; z is height above ground)
//   coP:                optional [x, y] — measured / estimated centre-of-pressure.
//                       If omitted, CoP is inferred from the CoM and horizontal
//                       acceleration via the inverted-pendulum / ZMP identity
//                       `coP = comPos - comAccel · comPos[2] / g`.
//   comAccel:           optional [ax, ay, az] — required only if `coP` is absent.
//   ankleTorqueLimitNm: optional scalar ankle-torque ceiling (default 90 Nm).
//
// Output:
//   {
//     status: 'ok' | 'warn' | 'fail' | 'not_computed',
//     reason: string | undefined,
//     coP: [x, y],
//     insideFoot: boolean,
//     minMarginM: number,         // smallest signed distance to the foot edge
//     marginX: number, marginY: number,
//     pressure: { heelPa, toePa, latInnerPa, latOuterPa, peakPa },
//     ankleTorque: { pitchNm, rollNm, magnitudeNm },
//     limitNm: number,
//     totalNormalForceN: number,
//     tipping: boolean,           // any edge pressure ≤ 0 ⇒ foot rotating
//     groundReactionForceLineOfAction: { x, y }  // == coP by definition
//   }
//
// Physics:
//   Linear-ramp pressure distribution (B83 / quarter-cycle results) under a
//   rigid rectangular foot. The pressure along the fore-aft axis varies
//   linearly so that the resultant vertical force acts at the CoP.
//
//   L = 2·halfX, W = 2·halfY
//     pHeel      = (2·Fz / L) · (0.5 − (coPx − x) / L)
//     pToe       = (2·Fz / L) · (0.5 + (coPx − x) / L)
//     pLatInner  = (2·Fz / W) · (0.5 − (coPy − y) / W)
//     pLatOuter  = (2·Fz / W) · (0.5 + (coPy − y) / W)
//
//   If any corner pressure ≤ 0 the foot has lifted there ⇒ the contact is
//   degenerating into a line/point and `tipping` becomes true.
//
//   Ankle torque required to keep the foot flat against the ground:
//     τ_pitch = Fz · (coPx − x)
//     τ_roll  = Fz · (coPy − y)
//
//   Status rules (in priority order):
//     not_computed   if CoP cannot be inferred at all
//     fail          if !insideFoot              (reason: "CoP outside foot patch")
//     warn          if tipping                 (heel/toe/inner/outer pressure ≤ 0)
//     fail          if |τ_pitch| > limit or |τ_roll| > limit
//     ok            otherwise
//
//   `groundReactionForceLineOfAction` is the point where the resultant GRF
//   would have to act so that the net moment about the foot centre is zero —
//   that is exactly the CoP for a rigid foot on a flat surface.

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const G = 9.80665;

function pressureAtEdge(Fz, length, offset) {
  // Generic linear-ramp: p(−L/2) = (2·Fz/L)·(0.5 − offset/L)
  //                      p(+L/2) = (2·Fz/L)·(0.5 + offset/L)
  // `offset` is the CoP displacement from the foot centre (signed).
  if (!(length > 0)) return 0;
  const twoFzOverL = (2 * Fz) / length;
  // Guard the second term: any non-finite offset would propagate, so clamp.
  const o = Number.isFinite(offset) ? offset : 0;
  return twoFzOverL * (0.5 + o / length);
}

export function pressureDistribution({
  footPatch,
  totalNormalForceN,
  comPos,
  coP,
  comAccel,
  ankleTorqueLimitNm = 90,
} = {}) {
  // ----- input validation ---------------------------------------------------
  if (!footPatch || typeof footPatch !== "object") {
    return { status: "not_computed", reason: "footPatch required" };
  }
  const { x: fx = 0, y: fy = 0, halfX, halfY } = footPatch;
  if (!(Number.isFinite(halfX) && halfX > 0) || !(Number.isFinite(halfY) && halfY > 0)) {
    return { status: "not_computed", reason: "footPatch.halfX/halfY must be positive numbers" };
  }
  if (!Number.isFinite(totalNormalForceN)) {
    return { status: "not_computed", reason: "totalNormalForceN required" };
  }
  if (!Array.isArray(comPos) || comPos.length < 3) {
    return { status: "not_computed", reason: "comPos [x,y,z] required" };
  }

  // ----- infer CoP ----------------------------------------------------------
  let coPx;
  let coPy;
  if (Array.isArray(coP) && coP.length >= 2 && Number.isFinite(coP[0]) && Number.isFinite(coP[1])) {
    coPx = coP[0];
    coPy = coP[1];
  } else if (Array.isArray(comAccel) && comAccel.length >= 2 && Number.isFinite(comAccel[0]) && Number.isFinite(comAccel[1])) {
    // Inverted-pendulum / ZMP identity:
    //   coP_xy = comPos_xy − comAccel_xy · z_com / g
    // Guard against zero/negative height and zero gravity.
    const z = Number.isFinite(comPos[2]) ? comPos[2] : 0;
    const denom = G;
    if (!(denom > 0) || !(z > 0)) {
      return { status: "not_computed", reason: "comPos[2] must be positive and G must be positive to infer CoP" };
    }
    coPx = comPos[0] - (comAccel[0] * z) / denom;
    coPy = comPos[1] - (comAccel[1] * z) / denom;
  } else {
    return { status: "not_computed", reason: "coP or comAccel required" };
  }

  if (!Number.isFinite(coPx) || !Number.isFinite(coPy)) {
    return { status: "not_computed", reason: "computed CoP is non-finite" };
  }

  // ----- inside-foot margins ------------------------------------------------
  const dx = coPx - fx;
  const dy = coPy - fy;
  const marginX = halfX - Math.abs(dx);
  const marginY = halfY - Math.abs(dy);
  const insideFoot = marginX >= 0 && marginY >= 0;
  const minMarginM = Math.min(marginX, marginY);

  // ----- linear-ramp pressures ---------------------------------------------
  // Fore-aft axis. `dx` is signed displacement of CoP from the foot centre.
  const pHeel = pressureAtEdge(totalNormalForceN, 2 * halfX, -dx);
  const pToe = pressureAtEdge(totalNormalForceN, 2 * halfX, dx);
  // Lateral axis.
  const pLatInner = pressureAtEdge(totalNormalForceN, 2 * halfY, -dy);
  const pLatOuter = pressureAtEdge(totalNormalForceN, 2 * halfY, dy);
  const peakPa = Math.max(pHeel, pToe, pLatInner, pLatOuter);

  // ----- tipping detection --------------------------------------------------
  // A negative edge pressure is non-physical; the foot has lifted off there
  // and is rotating about the opposite edge.
  const tipping = pHeel <= 0 || pToe <= 0 || pLatInner <= 0 || pLatOuter <= 0;

  // ----- ankle torque -------------------------------------------------------
  const ankleTorquePitchNm = totalNormalForceN * dx;
  const ankleTorqueRollNm = totalNormalForceN * dy;
  const magnitudeNm = Math.hypot(ankleTorquePitchNm, ankleTorqueRollNm);

  // ----- status -------------------------------------------------------------
  let status;
  let reason;
  if (!insideFoot) {
    status = "fail";
    reason = "CoP outside foot patch";
  } else if (tipping) {
    status = "warn";
    reason = "edge pressure ≤ 0 — foot is rotating";
  } else if (Math.abs(ankleTorquePitchNm) > ankleTorqueLimitNm || Math.abs(ankleTorqueRollNm) > ankleTorqueLimitNm) {
    status = "fail";
    reason = "ankle torque exceeds limit";
  } else {
    status = "ok";
    reason = undefined;
  }

  return {
    status,
    reason,
    coP: [coPx, coPy],
    insideFoot,
    minMarginM,
    marginX,
    marginY,
    pressure: {
      heelPa: pHeel,
      toePa: pToe,
      latInnerPa: pLatInner,
      latOuterPa: pLatOuter,
      peakPa,
    },
    ankleTorque: {
      pitchNm: ankleTorquePitchNm,
      rollNm: ankleTorqueRollNm,
      magnitudeNm,
    },
    limitNm: ankleTorqueLimitNm,
    totalNormalForceN,
    tipping,
    groundReactionForceLineOfAction: { x: coPx, y: coPy },
  };
}

registerSolver({
  id: "stability.pressure-distribution",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "stability.cop-pressure-ramp",
  fidelity: 1,
    // Graph-native: runs when any node carries props.stability.pressure.
  // The props subtree is passed straight through to pressureDistribution.
  targets: graphTargets("stability.pressure"),
  run: graphRunner("stability.pressure", (ctx, id, props) => envelope(pressureDistribution(props))),});

export default { pressureDistribution };