// server/lib/conkay/physics/solvers/kinematics-inverse-leg.js
//
// kinematics.inverse-leg — 2D planar inverse kinematics for a 3-link leg
// (hip → thigh → shin → foot) where the hip is fixed in world (single-support).
//
// Solves for joint angles q = [q_thigh, q_shin, q_foot] such that the foot
// reaches a target world position (tx, ty, tz) and optionally a target world
// orientation (yaw).
//
// Why this exists: gait.footstep-plan produces a foot trajectory in world
// coordinates but cannot report joint angles without it. This solver is
// the closed-form 2D IK that closes the not_inferred gap.
//
// Coordinate convention (matches the conkay humanoid):
//   - The hip is fixed at (basePos[0], basePos[1], basePos[2]) in world.
//   - Joint axes are +x (out of the page for side-elevation). q is measured
//     about +x, so positive q lifts the link toward +z (in thigh frame) or
//     equivalently forward in the y-z plane.
//   - link lengths are along the link's local +z axis from origin to next
//     joint origin.
//
// Algorithm:
//   Given the foot world target position relative to the hip:
//     dx = target.x - hip.x,  dy = target.y - hip.y,  dz = target.z - hip.z
//   Compute r = ||[dx,dy,dz]|| (distance hip-to-foot).
//   Given the foot's desired orientation (default: foot flat, roll=0, pitch=0):
//     - The "ankle angle" q_foot is solved last: it's the angle needed for
//       the foot link to align with the ground (or with the target orientation).
//     - The 2-bone sub-problem: solve q_thigh, q_shin so that the
//       ankle (i.e., shin tip) reaches the target offset of length
//       L_foot from the foot's world position (shifted by -q_foot).
//   Cosine rule + atan2 give the closed-form solution.
//
// Constraints enforced here (in addition to kinematic reach):
//   - link lengths must be finite and positive
//   - target must be within max reach and beyond min reach (no over-fold)
//   - any user-provided joint limits are checked
//
// Returns {status, q, perJoint, notGenerated, diagnostics}.
// status ∈ {"solved", "unreachable", "degenerate", "limit_violated"}.

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const G = 9.80665;

/** Planar distance between two 3D points (since joints are planar). */
function dist3(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Sub-problem: solve 2-bone IK in 2D.
 *  Given a base, a target offset (tx, ty, tz) in world, and link lengths
 *  (L1, L2), return [q1, q2] such that the tip reaches the target.
 *  Joint axes are +x; positive q lifts the link toward +z (in local frame).
 *  The first link's origin is at `base`, the second link's origin is at
 *  `base + R_x(q1)·(0,0,L1)`, and the tip is at
 *  `second + R_x(q1+q2)·(0,0,L2)`.
 *
 *  We solve in the y-z plane (x is the depth / pivot axis and stays 0).
 *  Returns {q1, q2, reachable} where reachable is false if the target is
 *  outside the L1+L2 reach or inside |L1-L2|.
 */
function solve2BoneIK(base, target, L1, L2) {
  // Joints are revolute about +x. Links extend from each joint origin along
  // the link's local -z.
  // The next joint's origin is at parent_origin + R_x(q)·(0,0,-L) =
  //   parent_origin + (0, sin(q)*L, -cos(q)*L) for axis=+x.
  // For q=0, the link extends straight down along -z.
  //
  // Substituting U = -dz, V = dy gives the standard 2-bone IK problem in
  // (U, V) where the chain extends along +U at q=0. The chain position in
  // (U, V) for (q1, q2) is:
  //   U = cos(q1)·L1 + cos(q1+q2)·L2
  //   V = sin(q1)·L1 + sin(q1+q2)·L2
  const dy = target[1] - base[1];
  const dz = target[2] - base[2];
  const U = -dz, V = dy;
  const r2 = U * U + V * V;
  const r = Math.sqrt(r2);

  if (r > L1 + L2 + 1e-9) return { reachable: false, reason: `r=${r.toFixed(4)} > max reach ${(L1 + L2).toFixed(4)}` };
  if (r < Math.abs(L1 - L2) - 1e-9) return { reachable: false, reason: `r=${r.toFixed(4)} < min reach ${Math.abs(L1 - L2).toFixed(4)}` };
  if (L1 <= 0 || L2 <= 0) return { reachable: false, reason: `L1 or L2 <= 0` };

  // Solve in (U, V) using the standard textbook formula (Spong §4.5).
  // Let target = (U, V), r = distance.
  // cosGamma = (L1² + r² - L2²)/(2·L1·r) = cos of the angle between L1 and the
  // vector from base to target. γ = acos(cosGamma) ∈ [0, π].
  const cosGamma = (L1 * L1 + r2 - L2 * L2) / (2 * L1 * r);
  const gamma = Math.acos(Math.max(-1, Math.min(1, cosGamma)));
  // α = atan2(V, U) is the angle from +U to the target.
  const alpha = Math.atan2(V, U);

  // cos(beta) = (L1² + L2² - r²)/(2·L1·L2) where beta is the interior angle at the elbow.
  // q2 is the angle between the two bones: if both bones point in the same direction,
  // q2 = 0. With L1 along +U (q1=0) and L2 along +U (q1+q2=0), q2 = 0.
  // cos(q2) = (r² - L1² - L2²)/(2·L1·L2) = -cos(beta).
  // So q2 = ±acos((r² - L1² - L2²)/(2·L1·L2)) = ±(π - beta).
  const cosQ2 = (r2 - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  const q2abs = Math.acos(Math.max(-1, Math.min(1, cosQ2)));

  // Branches:
  //   elbow-up:   q1 = alpha + gamma, q2 = +q2abs  (knee forward, q2 positive)
  //   elbow-down: q1 = alpha - gamma, q2 = -q2abs  (knee backward, q2 negative)
  // But we choose by which one actually reaches the target.
  const candidates = [
    { q1: alpha + gamma, q2:  q2abs, name: "up" },
    { q1: alpha - gamma, q2: -q2abs, name: "down" },
    { q1: alpha + gamma, q2: -q2abs, name: "up-bent-back" },
    { q1: alpha - gamma, q2:  q2abs, name: "down-bent-back" },
  ];
  const validate = (c) => {
    const sU = Math.cos(c.q1) * L1 + Math.cos(c.q1 + c.q2) * L2;
    const sV = Math.sin(c.q1) * L1 + Math.sin(c.q1 + c.q2) * L2;
    return Math.abs(sU - U) + Math.abs(sV - V);
  };
  for (const c of candidates) {
    if (validate(c) < 1e-9) {
      // Found a valid branch with high precision.
      const others = candidates.filter((c2) => c2 !== c && validate(c2) < 1e-9);
      return { reachable: true, q1: c.q1, q2: c.q2, picked: c.name, r,
               elbowDown: others.length > 0 ? { q1: others[0].q1, q2: others[0].q2 } : null,
               kneeBentForward: c.q2 > 0 };
    }
  }
  // Fallback: best candidate.
  let best = null, bestErr = Infinity;
  for (const c of candidates) {
    const err = validate(c);
    if (err < bestErr) { bestErr = err; best = c; }
  }
  if (best && bestErr < 1e-4) {
    const others = candidates.filter((c2) => c2 !== best && validate(c2) < 1e-4);
    return { reachable: true, q1: best.q1, q2: best.q2, picked: best.name, r,
             elbowDown: others.length > 0 ? { q1: others[0].q1, q2: others[0].q2 } : null,
             kneeBentForward: best.q2 > 0 };
  }
  return { reachable: false, reason: `no branch reaches (U=${U.toFixed(4)}, V=${V.toFixed(4)}) from r=${r.toFixed(4)}` };
}

/** Public API. */
export function inverseLegIK({
  hipPos,                        // [x, y, z] base of the leg in world
  L1, L2, L3,                    // thigh, shin, foot lengths (m)
  targetFootPos,                 // [x, y, z] foot tip in world
  footOrientationDeg = 0,        // target foot pitch about +x axis (deg)
  jointLimits = null,            // optional { thigh: [min,max], shin: [...], foot: [...] }
  preferElbowDown = false,
}) {
  const diag = { L1, L2, L3, hipPos, targetFootPos };
  if (!Array.isArray(hipPos) || hipPos.length !== 3) return { status: "degenerate", reason: "hipPos must be [x,y,z]", diagnostics: diag };
  if (!Array.isArray(targetFootPos) || targetFootPos.length !== 3) return { status: "degenerate", reason: "targetFootPos must be [x,y,z]", diagnostics: diag };
  if (!Number.isFinite(L1) || L1 <= 0) return { status: "degenerate", reason: "L1 (thigh) must be > 0", diagnostics: diag };
  if (!Number.isFinite(L2) || L2 <= 0) return { status: "degenerate", reason: "L2 (shin) must be > 0", diagnostics: diag };
  if (!Number.isFinite(L3) || L3 <= 0) return { status: "degenerate", reason: "L3 (foot) must be > 0", diagnostics: diag };

  // Step 1: compute the ankle target (shin tip = foot root).
  // The foot's tip in world is at ankle + R_x(θ_total)·(0,0,-L3) where
  //   θ_total = q_thigh + q_shin + q_foot. So given desired θ_total,
  //   ankle = foot_target − R_x(θ_total)·(0,0,-L3) = foot_target + R_x(-θ_total)·(0,0,L3)
  //        = foot_target + (0, sin(θ_total)·L3, cos(θ_total)·L3).
  // θ_total = -footOrientationRad so the foot's local -z in world = R_x(θ_total)·(0,0,-1).
  // For footOrientationDeg = 0 (foot flat on ground), θ_total = 0 and the foot's
  // -z in world = (0, 0, -1) (straight down).
  const footOrientationRad = footOrientationDeg * Math.PI / 180;
  const thetaTotal = -footOrientationRad;
  const ankleTarget = [
    targetFootPos[0],
    targetFootPos[1] + Math.sin(thetaTotal) * L3,
    targetFootPos[2] + Math.cos(thetaTotal) * L3,
  ];

  // Step 2: solve 2-bone IK from hip to ankle.
  // The chain is hip → thigh → shin → ankle, so the 2-bone sub-problem
  // is from hip to ankle with bones (L1, L2).
  const ik = solve2BoneIK(hipPos, ankleTarget, L1, L2);
  diag.ik = ik;
  if (!ik.reachable) {
    return { status: "unreachable", reason: ik.reason, diagnostics: diag, q: null, perJoint: null };
  }
  const q_thigh = ik.q1;
  const q_shin = ik.q2;
  // The foot joint angle un-rotates the foot from the cumulative chain rotation.
  // The cumulative rotation θ_total = q_thigh + q_shin + q_foot controls the foot's
  // orientation in world. With θ_total = thetaTotal (set above), q_foot is determined.
  const q_foot = thetaTotal - (q_thigh + q_shin);

  let q = [q_thigh, q_shin, q_foot];

  // Apply alternative elbow-down branch if requested.
  if (preferElbowDown && ik.elbowDown) {
    q = [ik.elbowDown.q1, ik.elbowDown.q2, thetaTotal - (ik.elbowDown.q1 + ik.elbowDown.q2)];
  }

  // Joint-limit check.
  const perJoint = [
    { linkId: "thigh", axis: "x", q: q[0] },
    { linkId: "shin",  axis: "x", q: q[1] },
    { linkId: "foot",  axis: "x", q: q[2] },
  ];
  if (jointLimits) {
    for (const j of perJoint) {
      const lim = jointLimits[j.linkId];
      if (Array.isArray(lim) && lim.length === 2) {
        j.limitMin = lim[0]; j.limitMax = lim[1];
        if (j.q < lim[0] || j.q > lim[1]) {
          j.inLimit = false;
          return {
            status: "limit_violated",
            reason: `joint ${j.linkId} q=${j.q.toFixed(4)} rad outside [${lim[0].toFixed(4)}, ${lim[1].toFixed(4)}]`,
            diagnostics: diag, q, perJoint,
          };
        }
        j.inLimit = true;
      }
    }
  }

  return { status: "solved", q, perJoint, diagnostics: diag };
}

/** Convenience wrapper for a single leg + a trajectory of foot targets.
 *  Returns the joint trajectory (q, qdot, qddot via finite differences) that
 *  follows the target trajectory. Calls inverseLegIK per waypoint.
 */
export function inverseLegTrajectory({
  hipPos, L1, L2, L3, footTrajectory, dt, jointLimits = null, preferElbowDown = false,
}) {
  if (!Array.isArray(footTrajectory) || footTrajectory.length === 0) {
    return { status: "degenerate", reason: "footTrajectory must be non-empty" };
  }
  if (!Number.isFinite(dt) || dt <= 0) {
    return { status: "degenerate", reason: "dt must be > 0" };
  }
  const frames = [];
  for (let i = 0; i < footTrajectory.length; i += 1) {
    const tgt = footTrajectory[i];
    const r = inverseLegIK({ hipPos, L1, L2, L3, targetFootPos: tgt.pos, footOrientationDeg: tgt.pitchDeg || 0, jointLimits, preferElbowDown });
    frames.push({ i, t: i * dt, target: tgt, status: r.status, reason: r.reason || null, q: r.q, perJoint: r.perJoint });
  }
  // Finite-difference velocities and accelerations.
  for (let i = 0; i < frames.length; i += 1) {
    if (!frames[i].q) { frames[i].qdot = null; frames[i].qddot = null; continue; }
    const iPrev = Math.max(0, i - 1);
    const iNext = Math.min(frames.length - 1, i + 1);
    if (i === 0) {
      frames[i].qdot = frames[i].q.map(() => 0);
      frames[i].qddot = frames[i].q.map(() => 0);
    } else {
      frames[i].qdot = frames[i].q.map((q, j) => (frames[i].q[j] - frames[iPrev].q[j]) / dt);
      const prevQdot = frames[iPrev].qdot || frames[i].qdot;
      frames[i].qddot = frames[i].qdot.map((qd, j) => (qd - prevQdot[j]) / dt);
    }
  }
  return { status: "ok", frames };
}

registerSolver({
  id: "kinematics.inverse-leg",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "ik.2bone-cosine-rule",
  fidelity: 1,
    // Graph-native: runs when any node carries props.kinematics.legIK.
  // The props subtree is passed straight through to inverseLegIK.
  targets: graphTargets("kinematics.legIK"),
  run: graphRunner("kinematics.legIK", (ctx, id, props) => envelope(inverseLegIK(props))),});