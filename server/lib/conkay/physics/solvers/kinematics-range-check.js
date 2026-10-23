// server/lib/conkay/physics/solvers/kinematics-range-check.js
//
// kinematics.range-check — per-joint range-of-motion enforcement.
//
// Inputs:
//   joints: Array<{linkId, q, qdot?, qddot?}>   — pose + state
//   limits: { [linkId]: { min:rad, max:rad, maxSpeedRadps?:number, maxAccRadps2?:number } }
//
// Output:
//   { status: "ok"|"warn"|"fail"|"not_computed",
//     perJoint: [{linkId, q, qdot, inRange, inRangeSpeed, marginRad, marginSpeed, status, warnings}],
//     aggregate: { warnCount, failCount, totalChecks },
//     notes: [...] }
//
// Convention: qdot is the joint angular velocity about the joint axis.
// A status of "not_computed" is returned when limits are missing.

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const G = 9.80665;

/** Single-trajectory range check. */
export function rangeCheckTrajectory({ joints, limits, warnMarginDeg = 5, hysteresisDeg = 1 }) {
  // joints: array of frames; each frame is { [linkId]: q (number) OR
  //   { q: number, qdot?: number, qddot?: number } }
  const diag = { frames: joints.length, joints: limits ? Object.keys(limits) : [] };
  if (!Array.isArray(joints) || joints.length === 0) return { status: "not_computed", reason: "joints array required", diagnostics: diag };
  if (!limits || typeof limits !== "object") return { status: "not_computed", reason: "limits object required", diagnostics: diag };

  const linkIds = Object.keys(limits);
  const warnMarginRad = warnMarginDeg * Math.PI / 180;
  const hysteresisRad = hysteresisDeg * Math.PI / 180;

  const frames = [];
  let aggregate = "ok";
  const warnCount = { byType: { inRange: 0, inRangeSpeed: 0, inRangeAcc: 0 } };
  const failCount = { byType: { inRange: 0, inRangeSpeed: 0, inRangeAcc: 0 } };

  for (let i = 0; i < joints.length; i += 1) {
    const frame = joints[i];
    const perJoint = [];
    for (const linkId of linkIds) {
      const limit = limits[linkId];
      const x = typeof frame[linkId] === "number" ? { q: frame[linkId] } : (frame[linkId] || {});
      const q = x.q;
      const qdot = x.qdot;
      const qddot = x.qddot;
      if (!Number.isFinite(q)) {
        perJoint.push({ linkId, status: "not_computed", reason: "missing q" });
        continue;
      }
      const inRange = q >= limit.min - 1e-9 && q <= limit.max + 1e-9;
      // Distance to nearest limit (positive = inside, negative = outside).
      const marginRad = Math.min(q - limit.min, limit.max - q);
      const marginDeg = marginRad * 180 / Math.PI;
      let status = "ok";
      const warnings = [];
      if (!inRange) status = "fail";
      else if (marginDeg < warnMarginDeg) status = "warn";
      if (status === "fail") { failCount.byType.inRange += 1; aggregate = "fail"; }
      else if (status === "warn" && aggregate !== "fail") { warnCount.byType.inRange += 1; aggregate = "warn"; }
      let inRangeSpeed = null, marginSpeed = null;
      if (Number.isFinite(qdot) && Number.isFinite(limit.maxSpeedRadps)) {
        inRangeSpeed = Math.abs(qdot) <= limit.maxSpeedRadps;
        marginSpeed = limit.maxSpeedRadps - Math.abs(qdot);
        if (!inRangeSpeed) { status = "fail"; failCount.byType.inRangeSpeed += 1; aggregate = "fail"; }
      }
      let inRangeAcc = null;
      if (Number.isFinite(qddot) && Number.isFinite(limit.maxAccRadps2)) {
        inRangeAcc = Math.abs(qddot) <= limit.maxAccRadps2;
        if (!inRangeAcc) { status = "fail"; failCount.byType.inRangeAcc += 1; aggregate = "fail"; }
      }
      perJoint.push({
        linkId,
        q,
        qdot,
        qddot,
        limitMin: limit.min, limitMax: limit.max,
        maxSpeedRadps: limit.maxSpeedRadps, maxAccRadps2: limit.maxAccRadps2,
        inRange, inRangeSpeed, inRangeAcc,
        marginRad, marginDeg, marginSpeed,
        status, warnings,
      });
    }
    frames.push({ i, perJoint });
  }
  // Hysteresis pass: if a frame is in warn, allow it as long as the previous frame was also warn.
  if (hysteresisRad > 0 && frames.length > 1) {
    for (let i = 1; i < frames.length; i += 1) {
      for (const j of frames[i].perJoint) {
        if (j.status === "warn" && j.marginRad > hysteresisRad) {
          // Below hysteresis threshold, OK back to ok.
          j.status = "ok";
        }
      }
    }
  }
  return { status: aggregate, frames, aggregate: { warnCount, failCount }, diagnostics: diag };
}

/** Single-pose variant. */
export function rangeCheckSingle({ pose, limits, warnMarginDeg = 5 }) {
  if (!pose || typeof pose !== "object") return { status: "not_computed", reason: "pose required" };
  if (!limits || typeof limits !== "object") return { status: "not_computed", reason: "limits required" };
  return rangeCheckTrajectory({ joints: [pose], limits, warnMarginDeg });
}

registerSolver({
  id: "kinematics.range-check",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "constraint.joint-range",
  fidelity: 1,
    // Graph-native: runs when any node carries props.kinematics.rangeCheck.
  // The props subtree is passed straight through to rangeCheckTrajectory.
  targets: graphTargets("kinematics.rangeCheck"),
  run: graphRunner("kinematics.rangeCheck", (ctx, id, props) => envelope(rangeCheckTrajectory(props))),
});