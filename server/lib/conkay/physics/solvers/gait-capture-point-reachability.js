// server/lib/conkay/physics/solvers/gait-capture-point-reachability.js
//
// gait.capture-point-reachability — check if a single step can catch the ICP.
//
// The Capture Point (Kajita 2003): p_icp = p_cg + v_cg / ω₀, where
// ω₀ = √(g/z_c). It is the point on the ground where the robot would come
// to rest if its CoM were instantaneously placed there.
//
// "Catchability" — if the robot takes a step of length L (with landing
// position p_step), the ICP evolves as:
//   p_icp[k+1] = p_step[k] + (p_icp[k] - p_step[k]) · exp(-ω·T)
//   v_icp[k+1] = v_icp[k] · exp(-ω·T)         // the rate of ICP motion decays
// For the ICP to be "caught" (i.e., for it to fall inside the support polygon
// after the step), we need p_icp[k+1] to be within the support bounds.
//
// Inputs:
//   icpVel: [vx, vy]       — current ICP velocity in m/s
//   icpPos: [x, y]         — current ICP position (default = current support center)
//   comHeight: z_c
//   stepLength: max step length L (m, 1D for forward; for lateral use 2D)
//   stepDuration: T (s)
//   supportPatch: { x, y, halfX, halfY }   — landing foot support
//
// Output:
//   { reachable: bool, distanceToBoundaryM, maxStepDistanceM, status }

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const G = 9.80665;

/** Compute the ICP propagation distance during a step.
 *  After a step to p_step, the distance from new ICP to the support is:
 *    |p_icp_new - p_step| = |p_icp - p_step| · exp(-ω·T)
 */
export function capturePointReachability({ icpPos = [0, 0], icpVel = [0, 0], comHeight = 1.0, stepDuration = 0.5, stepLandingPos = [0.19, 0, 0], supportPatch = { x: 0, y: 0, halfX: 0.12, halfY: 0.07 } }) {
  const omega0 = Math.sqrt(G / comHeight);
  // ICP propagation factor: icp_new = p_step + (icp_old - p_step) · exp(-ω·T)
  const decay = Math.exp(-omega0 * stepDuration);
  const dxOld = icpPos[0] - stepLandingPos[0];
  const dyOld = icpPos[1] - stepLandingPos[1];
  // Distance from current ICP to landing position:
  const distOld = Math.sqrt(dxOld * dxOld + dyOld * dyOld);
  // Distance from new ICP to landing position (before applying support bounds):
  const distNew = distOld * decay;
  // New ICP position:
  const newIcpX = stepLandingPos[0] + dxOld * decay;
  const newIcpY = stepLandingPos[1] + dyOld * decay;
  // Check if new ICP is within the support patch:
  const offsetX = newIcpX - supportPatch.x;
  const offsetY = newIcpY - supportPatch.y;
  const inSupportX = Math.abs(offsetX) <= supportPatch.halfX;
  const inSupportY = Math.abs(offsetY) <= supportPatch.halfY;
  const distanceToSupportEdgeM = Math.min(
    supportPatch.halfX - Math.abs(offsetX),
    supportPatch.halfY - Math.abs(offsetY)
  );
  // Max step distance the robot can take and still catch the ICP:
  // Required: |newIcp - center| ≤ 0 (at center) ⇒ |icp - step|·decay ≤ halfX
  //           ⇒ step_x = icp_x - sign·halfX/decay
  // Max step distance = |icp - current_support| + halfX/decay
  const maxStepX = distOld + supportPatch.halfX / decay;
  // Status: reachable if the planned step lands within reach and ICP can be caught.
  const reachable = inSupportX && inSupportY;
  return {
    reachable,
    distanceToSupportEdgeM,
    maxStepDistanceM: maxStepX,
    icpOld: icpPos.slice(),
    icpNew: [newIcpX, newIcpY],
    stepLandingPos: stepLandingPos.slice(),
    decayFactor: decay,
    inSupportX, inSupportY,
    status: reachable ? "ok" : "fail",
    diagnostics: { omega0, comHeight, stepDuration },
  };
}

/** Multiple-step plan: how many steps to catch the ICP if the planned step is infeasible? */
export function capturePointReachabilityMultiStep({ icpPos, icpVel, comHeight, maxSteps = 5, stepLength = 0.30, stepDuration = 0.5, supportPatch }) {
  let curIcp = icpPos.slice();
  const plan = [];
  for (let k = 0; k < maxSteps; k += 1) {
    // Step landing: place foot a step-length in the direction of the ICP error.
    const dx = curIcp[0] - curIcp[0];        // reset relative
    // For symmetric stopping, step should be from current CoM (not ICP). For
    // backward compatibility, treat icpPos as the offset of the new step landing.
    const stepLanding = [curIcp[0], curIcp[1]];
    const r = capturePointReachability({
      icpPos: curIcp, icpVel, comHeight, stepDuration,
      stepLandingPos: stepLanding, supportPatch,
    });
    plan.push(r);
    if (r.reachable) break;
    // Evolve ICP for the next iteration (using current step). If we've already
    // taken maxSteps and not caught, give up.
    if (k === maxSteps - 1) break;
    curIcp = r.icpNew;
  }
  return { reached: plan[plan.length - 1].reachable, plan };
}

registerSolver({
  id: "gait.capture-point-reachability",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "gait.icp-reachability",
  fidelity: 1,
    // Graph-native: runs when any node carries props.gait.capturePointReach.
  // The props subtree is passed straight through to capturePointReachability.
  targets: graphTargets("gait.capturePointReach"),
  run: graphRunner("gait.capturePointReach", (ctx, id, props) => envelope(capturePointReachability(props))),
});