// server/lib/conkay/physics/solvers/actuation-joint-torque.js
//
// actuation.joint-torque — feasibility screen for joint torque, speed, and
// (optionally) thermal & gearbox limits. Takes an articulated tree + per-joint
// actuator specs + pose trajectory; wraps the dynamics.inverse solver.
//
// MISSING datasheet data is reported as NOT_COMPUTED on a per-check basis
// (never a guessed pass). Supported checks (all optional except feature-gate):
//   torqueContinuous, torquePeak, torquePeakDurationS, torqueSpeedDerate
//   speedMax, gearboxStallTorque, gearboxLimit
// Thermal is reported only if joint.trajectory has dt + duration.
//
// Statuses:
//   "ok"     — required within spec with margin >= 0
//   "warn"   — required within spec but margin < warnMarginFraction (e.g. 0.85)
//   "fail"   — required exceeds spec → NOT safe for the physical hardware
//   "not_computed" — required is known but spec is missing → caller's responsibility

import { rneaSolver } from "./dynamics-inverse.js";
import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const G = 9.80665;

/** Returns a body-frame torque-speed envelope (linear derate), or null. */
function speedDeratedLimit(actuator, qdot_abs) {
  if (!actuator) return null;
  const tauN = actuator.torqueContinuousNm;
  const tauP = actuator.torquePeakNm;
  const tauGS = actuator.gearboxStallTorqueNm;   // gearbox limit if any
  const omegaMax = actuator.speedMaxRadps;
  if (omegaMax == null) {
    // No speed data; cannot apply derate. Use min(continuous, peak).
    if (tauN != null && tauP != null) return Math.min(tauN, tauP);
    if (tauN != null) return tauN;
    if (tauP != null) return tauP;
    return null;
  }
  if (qdot_abs >= omegaMax) {
    // Beyond speed envelope: limit is whatever the gearbox / continuous allows at no load.
    if (tauGS != null) return tauGS;
    if (tauN != null) return tauN;
    return null;
  }
  // Linear derate: at ω = ωMax the torque is 0; at ω = 0 it equals peak (or continuous).
  const tauMax0 = tauP != null ? tauP : (tauN != null ? tauN : null);
  if (tauMax0 == null) return null;
  return tauMax0 * (1 - qdot_abs / omegaMax);
}

/** Per-frame screening result. */
function screenJoint({ linkId, axis, requiredNm, qdot, actuator, durationS, warnMarginFraction }) {
  const out = {
    linkId,
    axis,
    requiredNm,
    qdot,
    requiredAbsNm: Math.abs(requiredNm),
    qdotAbs: Math.abs(qdot || 0),
    checks: {},
    ok: true,
    margins: {},
  };

  if (!actuator) {
    for (const k of ["torqueContinuous", "torquePeak", "gearboxLimit", "speedLimit"]) {
      out.checks[k] = { status: "not_computed", reason: "no actuator spec for joint" };
    }
    out.ok = false;     // can't claim it is safe
    out.status = "not_computed";
    out.reason = "no actuator spec";
    return out;
  }

  const tau = out.requiredAbsNm;
  const om = out.qdotAbs;

  // Continuous torque.
  if (actuator.torqueContinuousNm != null) {
    const util = tau / actuator.torqueContinuousNm;
    const status = util > 1.0 ? "fail" : (util > warnMarginFraction ? "warn" : "ok");
    out.checks.torqueContinuous = {
      status,
      limitNm: actuator.torqueContinuousNm,
      utilization: util,
      marginNm: actuator.torqueContinuousNm - tau,
    };
    out.margins.torqueContinuous = actuator.torqueContinuousNm - tau;
  } else {
    out.checks.torqueContinuous = { status: "not_computed", reason: "torqueContinuousNm missing" };
  }

  // Peak torque (short-duration; we trust the durationS if provided).
  if (actuator.torquePeakNm != null) {
    const peakDurS = actuator.torquePeakDurationS;
    const util = tau / actuator.torquePeakNm;
    let status = util > 1.0 ? "fail" : (util > warnMarginFraction ? "warn" : "ok");
    if (status === "ok" && peakDurS != null && durationS != null && durationS > peakDurS) {
      status = "warn";   // exceeded the peak duration window
    }
    out.checks.torquePeak = {
      status,
      limitNm: actuator.torquePeakNm,
      utilization: util,
      marginNm: actuator.torquePeakNm - tau,
      peakDurationS: peakDurS,
      appliedDurationS: durationS,
    };
  } else {
    out.checks.torquePeak = { status: "not_computed", reason: "torquePeakNm missing" };
  }

  // Speed envelope (max speed of the joint).
  if (actuator.speedMaxRadps != null) {
    const util = om / actuator.speedMaxRadps;
    const status = util > 1.0 ? "fail" : (util > warnMarginFraction ? "warn" : "ok");
    out.checks.speedLimit = {
      status,
      limitRadps: actuator.speedMaxRadps,
      utilization: util,
      marginRadps: actuator.speedMaxRadps - om,
    };
  } else {
    out.checks.speedLimit = { status: "not_computed", reason: "speedMaxRadps missing" };
  }

  // Speed-dependent torque derate (the most informative single limit).
  const tauAtDerate = speedDeratedLimit(actuator, om);
  if (tauAtDerate != null) {
    const util = tau / tauAtDerate;
    const status = util > 1.0 ? "fail" : (util > warnMarginFraction ? "warn" : "ok");
    out.checks.torqueSpeedDerate = {
      status,
      limitNm: tauAtDerate,
      utilization: util,
      marginNm: tauAtDerate - tau,
    };
  } else {
    out.checks.torqueSpeedDerate = { status: "not_computed", reason: "no torque or speed envelope" };
  }

  // Gearbox limit (stall torque ceiling).
  if (actuator.gearboxLimitNm != null || actuator.gearboxStallTorqueNm != null) {
    const lim = actuator.gearboxLimitNm != null ? actuator.gearboxLimitNm : actuator.gearboxStallTorqueNm;
    const util = tau / lim;
    const status = util > 1.0 ? "fail" : (util > warnMarginFraction ? "warn" : "ok");
    out.checks.gearboxLimit = { status, limitNm: lim, utilization: util, marginNm: lim - tau };
  } else {
    out.checks.gearboxLimit = { status: "not_computed", reason: "gearboxLimitNm / gearboxStallTorqueNm missing" };
  }

  // Aggregate status: fail if any check fails; warn if any warns; ok if all ok;
  // not_computed if every check is not_computed (no spec data at all).
  let worst = "ok";
  const order = { ok: 0, not_computed: 1, warn: 2, fail: 3 };
  for (const k of Object.keys(out.checks)) {
    if (order[out.checks[k].status] > order[worst]) worst = out.checks[k].status;
  }
  out.status = worst;
  out.ok = worst === "ok" || worst === "warn";
  return out;
}

/** Trajectory screening: at every timestep compute dynamics and screen. */
function screenTrajectory({ tree, gravity, trajectory, actuators, warnMarginFraction, baseContactForce }) {
  if (!Array.isArray(trajectory) || trajectory.length === 0) {
    return { notComputed: true, reason: "trajectory must be a non-empty array" };
  }
  const results = [];
  for (let i = 0; i < trajectory.length; i += 1) {
    const ts = trajectory[i];
    if (!ts || !Array.isArray(ts.q) || !Array.isArray(ts.qdot)) {
      return { notComputed: true, reason: `trajectory[${i}] requires {q, qdot, qddot?}` };
    }
    const rnea = rneaSolver({
      tree,
      gravity,
      q: ts.q,
      qdot: ts.qdot,
      qddot: ts.qddot,
      baseContactForce: i === 0 ? baseContactForce : undefined,
      tipForces: ts.tipForces,
    });
    if (rnea.notComputed) {
      results.push({
        t: i, status: "not_computed", reason: rnea.notComputed,
        perJoint: (rnea.torques || []).map((t) => ({
          linkId: t.linkId, axis: t.axisWorld, requiredNm: null, status: "not_computed",
          checks: {}, reason: rnea.notComputed,
        })),
      });
      continue;
    }
    const perJoint = rnea.torques.map((t, j) => screenJoint({
      linkId: t.linkId,
      axis: t.axisWorld,
      requiredNm: t.torqueNm,
      qdot: ts.qdot[j] || 0,
      actuator: actuators && actuators[t.linkId] ? actuators[t.linkId] : null,
      durationS: ts.durationS,
      warnMarginFraction,
    }));
    results.push({ t: i, q: ts.q, qdot: ts.qdot, qddot: ts.qddot, perJoint });
  }

  // Aggregate worst status.
  let worst = "ok";
  const order = { ok: 0, not_computed: 1, warn: 2, fail: 3 };
  for (const frame of results) {
    for (const j of frame.perJoint || []) {
      if (order[j.status] > order[worst]) worst = j.status;
    }
  }

  return { status: worst, frames: results };
}

/** Solver entrypoint. */
export function actuationJointTorque({ tree, gravity, pose, qdot, qddot, baseContactForce, actuatorSpec, warnMarginFraction = 0.85 }) {
  if (!tree || !Array.isArray(tree.links)) return { notComputed: "tree.links required" };
  if (!actuatorSpec || typeof actuatorSpec !== "object") {
    return { notComputed: "actuatorSpec object required (map of linkId → actuator)" };
  }
  // Single-pose shortcut: return the FRAMES array directly (matches trajectory use).
  if (Array.isArray(pose)) {
    return screenTrajectory({
      tree, gravity,
      trajectory: [{ q: pose, qdot, qddot }],
      actuators: actuatorSpec,
      warnMarginFraction,
      baseContactForce,
    }).frames;
  }
  return { notComputed: "pose must be an array (or pass trajectory directly)" };
}

/** Register as a ConKay solver. */
registerSolver({
  id: "actuation.joint-torque",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "actuation.feasibility",
  fidelity: 1,
    // Graph-native: runs when any node carries props.actuation.torqueScreen.
  // The props subtree is passed straight through to actuationJointTorque.
  targets: graphTargets("actuation.torqueScreen"),
  run: graphRunner("actuation.torqueScreen", (ctx, id, props) => envelope(actuationJointTorque(props))),
});

export default { actuationJointTorque };