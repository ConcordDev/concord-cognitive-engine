// server/lib/conkay/physics/solvers/gait-swing-collision-check.js
//
// gait.swing-collision-check — swing-foot vs stance-leg collision check.
//
// The swing foot follows a trajectory during the swing phase. We check at
// every trajectory sample whether the swing foot's geometry collides with
// the stance leg's geometry, or with any other body parts.
//
// Input:
//   swingFootTrajectory: [{ t, pos:[x,y,z], pitch? }]
//   stanceLegBodies: [{ id, endA, endB, radius }]   — capsules for the stance leg
//   otherBodies: optional additional bodies to check
//   swingFootFootCapsule: { endA, endB, radius }
//
// Output:
//   { status, frameContacts:[{t, gapM, pair, status}], minClearanceM, worstPair }

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

function distSegmentToSegment(a1, a2, b1, b2) {
  // Brute-force sample N=10 for each segment.
  let minDist = Infinity;
  let bestPair = null;
  const N = 16;
  for (let i = 0; i <= N; i += 1) {
    const u = i / N;
    const pa = [
      a1[0] * (1 - u) + a2[0] * u,
      a1[1] * (1 - u) + a2[1] * u,
      a1[2] * (1 - u) + a2[2] * u,
    ];
    for (let j = 0; j <= N; j += 1) {
      const v = j / N;
      const pb = [
        b1[0] * (1 - v) + b2[0] * v,
        b1[1] * (1 - v) + b2[1] * v,
        b1[2] * (1 - v) + b2[2] * v,
      ];
      const dx = pa[0] - pb[0], dy = pa[1] - pb[1], dz = pa[2] - pb[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < minDist) {
        minDist = d;
        bestPair = { pa, pb };
      }
    }
  }
  return { distanceM: minDist, closestPair: bestPair };
}

export function swingCollisionCheck({ swingFootTrajectory, stanceLegBodies = [], otherBodies = [], swingFootRadius = 0.04, swingFootLength = 0.135, minClearanceM = 0.05 }) {
  if (!Array.isArray(swingFootTrajectory) || swingFootTrajectory.length === 0) {
    return { status: "not_computed", reason: "swingFootTrajectory required" };
  }
  const allBodies = [...stanceLegBodies, ...otherBodies];
  if (allBodies.length === 0) return { status: "not_computed", reason: "at least 1 body required" };

  const frameContacts = [];
  let worstGap = Infinity;
  let worstPair = null;
  let aggregate = "ok";

  for (const f of swingFootTrajectory) {
    const swingEndA = [f.pos[0], f.pos[1] - swingFootLength / 2, f.pos[2]];
    const swingEndB = [f.pos[0], f.pos[1] + swingFootLength / 2, f.pos[2]];
    let frameWorstGap = Infinity;
    for (const body of allBodies) {
      const d = distSegmentToSegment(swingEndA, swingEndB, body.endA, body.endB);
      const gap = d.distanceM - swingFootRadius - body.radius;
      if (gap < frameWorstGap) {
        frameWorstGap = gap;
        frameContacts.push({ t: f.t, gapM: gap, swingFootPos: f.pos.slice(), pair: [body.id, "swing_foot"] });
      }
      if (gap < -1e-6) aggregate = "fail";
      else if (gap < minClearanceM) { if (aggregate === "ok") aggregate = "warn"; }
    }
    if (frameWorstGap < worstGap) { worstGap = frameWorstGap; worstPair = frameContacts[frameContacts.length - 1]; }
  }
  return { status: aggregate, frameContacts, minClearanceM: worstGap, worstPair };
}

registerSolver({
  id: "gait.swing-collision-check",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "collision.swing-stance",
  fidelity: 1,
    // Graph-native: runs when any node carries props.gait.swingCollision.
  // The props subtree is passed straight through to swingCollisionCheck.
  targets: graphTargets("gait.swingCollision"),
  run: graphRunner("gait.swingCollision", (ctx, id, props) => envelope(swingCollisionCheck(props))),});