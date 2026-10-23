// server/lib/conkay/physics/solvers/kinematics-self-collision-2d.js
//
// kinematics.self-collision-2d — capsule-vs-capsule collision check.
//
// Each body part is modeled as a capsule (swept sphere along an axis). Given
// the world pose of each part, the solver checks every pair (i, j) for
// intersection. If they intersect, the minimum separation distance is
// reported; if non-intersecting, the minimum distance between them.
//
// Self-collision means pairs where both parts belong to the same humanoid
// (the test configures which pairs are "self" — anything not on an "exclude"
// list is checked).
//
// Inputs:
//   bodies: Array<{ id, parent, axis:[x,y,z], origin:[x,y,z], length, radius, q }>
//   worldFrame: [{ id, positionW:[x,y,z], rotationW:3x3 (column-major) }]
//   excludes: optional array of [id1, id2] pairs to skip
//   minClearanceM: optional minimum clearance (m). Default 0.
//
// Output:
//   { status: "ok"|"warn"|"fail"|"not_computed",
//     contacts: [{i, j, distanceM, gapM (positive = separated, negative = penetration), normal:[dx,dy,dz]}],
//     aggregate: { totalChecked, totalIntersecting, totalWarnings } }

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const G = 9.80665;

/** Distance from a 3D point to a capsule (line segment + radius).
 *  Returns the minimum distance; if point is inside the capsule's "tube",
 *  the distance is 0 (interior penetration).
 */
function distPointToCapsule(p, a, b, radius) {
  const ax = a[0], ay = a[1], az = a[2];
  const bx = b[0], by = b[1], bz = b[2];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = p[0] - ax, apy = p[1] - ay, apz = p[2] - az;
  const abLen2 = abx * abx + aby * aby + abz * abz;
  if (abLen2 < 1e-12) {
    // Degenerate capsule (zero-length): use point-to-point distance.
    return Math.sqrt(apx * apx + apy * apy + apz * apz) - radius;
  }
  let t = (apx * abx + apy * aby + apz * abz) / abLen2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx, cy = ay + t * aby, cz = az + t * abz;
  const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
}

/** Distance between two capsules (segments + radii). Returns the gap
 *  (positive = separated, negative = penetration).
 */
function distCapsuleCapsule(a, b, aEndA, aEndB, bEndA, bEndB, radiusA, radiusB) {
  // For 2D (planar motion in y-z), a brute-force sample works well.
  // Sample N=10 points along each capsule and take minimum over all pairs.
  const N = 16;
  let minDist = Infinity;
  let closestPair = null;
  for (let i = 0; i <= N; i += 1) {
    const u = i / N;
    const pa = [
      aEndA[0] * (1 - u) + aEndB[0] * u,
      aEndA[1] * (1 - u) + aEndB[1] * u,
      aEndA[2] * (1 - u) + aEndB[2] * u,
    ];
    for (let j = 0; j <= N; j += 1) {
      const v = j / N;
      const pb = [
        bEndA[0] * (1 - v) + bEndB[0] * v,
        bEndA[1] * (1 - v) + bEndB[1] * v,
        bEndA[2] * (1 - v) + bEndB[2] * v,
      ];
      const dx = pa[0] - pb[0], dy = pa[1] - pb[1], dz = pa[2] - pb[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < minDist) {
        minDist = d;
        closestPair = { pa, pb };
      }
    }
  }
  if (!closestPair) return -Infinity;
  const gap = minDist - radiusA - radiusB;
  let normal = null;
  const dx = closestPair.pb[0] - closestPair.pa[0];
  const dy = closestPair.pb[1] - closestPair.pa[1];
  const dz = closestPair.pb[2] - closestPair.pa[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len > 1e-9) normal = [dx / len, dy / len, dz / len];
  return { gap, normal, closestDistance: minDist };
}

/** Single-pose collision check. */
export function selfCollisionCheck2D({ bodies, worldFrame, excludes = [], minClearanceM = 0, warnMarginM = 0.005 }) {
  if (!Array.isArray(bodies) || bodies.length === 0) {
    return { status: "not_computed", reason: "bodies array required" };
  }
  if (!Array.isArray(worldFrame) || worldFrame.length !== bodies.length) {
    return { status: "not_computed", reason: "worldFrame must have one entry per body" };
  }

  // Compute capsule endpoints for each body in world.
  const capsules = bodies.map((b, i) => {
    const wf = worldFrame[i];
    if (!wf || !wf.positionW) return null;
    // Capsule endpoints: body origin +/- half-length along axis (rotated by body R and q).
    const halfL = b.length / 2;
    // Apply body rotation: axis_world = R_body · axis_local. For simplicity, treat
    // q as rotation about +x if axis is [1,0,0]. We build a small per-body R.
    const cx = Math.cos(b.q || 0), sx = Math.sin(b.q || 0);
    // For axis = [1,0,0], rotation by q about +x:
    //   (a,b,c) -> (a, c·sin + b·cos, c·cos - b·sin)  for axis +x
    // Actually R_x(q) = [[1,0,0],[0,cos,-sin],[0,sin,cos]].
    //   (ax, ay, az) -> (ax, ay·cos - az·sin, ay·sin + az·cos).
    const ax = b.axis[0], ay = b.axis[1], az = b.axis[2];
    const axisWorld = [ax, ay * cx - az * sx, ay * sx + az * cx];
    const [px, py, pz] = wf.positionW;
    const endA = [px - axisWorld[0] * halfL, py - axisWorld[1] * halfL, pz - axisWorld[2] * halfL];
    const endB = [px + axisWorld[0] * halfL, py + axisWorld[1] * halfL, pz + axisWorld[2] * halfL];
    return { id: b.id, endA, endB, radius: b.radius, axisWorld };
  });

  // Pairwise check.
  const contacts = [];
  let totalChecked = 0, totalIntersecting = 0, totalWarnings = 0;
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      // Skip excluded pairs.
      if (excludes.some(([a, b]) => (a === bodies[i].id && b === bodies[j].id) || (a === bodies[j].id && b === bodies[i].id))) continue;
      // Skip parent-child (a body can't collide with its immediate parent since they're connected at the joint).
      if (bodies[i].parent === bodies[j].id || bodies[j].parent === bodies[i].id) continue;
      totalChecked += 1;
      const A = capsules[i], B = capsules[j];
      if (!A || !B) continue;
      const d = distCapsuleCapsule(bodies[i], bodies[j], A.endA, A.endB, B.endA, B.endB, A.radius, B.radius);
      const gap = d.gap;
      let status = "ok";
      if (gap < -1e-6) { status = "colliding"; totalIntersecting += 1; }
      else if (gap < minClearanceM) { status = "below_clearance"; }
      else if (gap < minClearanceM + warnMarginM) { status = "warn"; totalWarnings += 1; }
      contacts.push({ i: bodies[i].id, j: bodies[j].id, distanceM: d.closestDistance, gapM: gap, normal: d.normal, status });
    }
  }

  let aggregateStatus = "ok";
  if (totalIntersecting > 0) aggregateStatus = "fail";
  else if (contacts.some((c) => c.status === "warn")) aggregateStatus = "warn";
  else if (contacts.some((c) => c.status === "below_clearance")) aggregateStatus = "warn";  // safety margin violated

  return { status: aggregateStatus, contacts, aggregate: { totalChecked, totalIntersecting, totalWarnings, minClearanceM } };
}

registerSolver({
  id: "kinematics.self-collision-2d",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "collision.capsule-capsule",
  fidelity: 1,
    // Graph-native: runs when any node carries props.kinematics.selfCollision.
  // The props subtree is passed straight through to selfCollisionCheck2D.
  targets: graphTargets("kinematics.selfCollision"),
  run: graphRunner("kinematics.selfCollision", (ctx, id, props) => envelope(selfCollisionCheck2D(props))),});