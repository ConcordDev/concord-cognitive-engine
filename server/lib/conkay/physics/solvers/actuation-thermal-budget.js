// server/lib/conkay/physics/solvers/actuation-thermal-budget.js
//
// actuation.thermal-budget — motor thermal model.
//
// Takes a per-joint torque/speed trajectory and computes the per-motor thermal
// load. The motor model is:
//   I_motor = τ / Kt·η       (motor current)
//   P_cu    = I² · R          (copper losses)
//   P_other = (constant)      (core/iron losses — typically much smaller)
//   T_motor (next) = T_motor + (T - T_amb) · (1 - exp(-dt/τ_th)) + P·dt·R_th
//
// Where R = phase resistance, τ_th = thermal time constant, R_th = thermal resistance.
// With T_amb as the ambient (or heatsink) temperature.
//
// Each joint has an actuator with:
//   Kt (Nm/A), R (ohms), τ_th (s), R_th (K/W), T_max (K, derate), T_amb (K, default 25°C).
//
// Output:
//   perJoint: [{linkId, T_maxReachedK, energyKJ, status: "ok"|"warn"|"fail", frames:[]}],
//   aggregate: { overTempJoints, totalEnergyKJ }

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

/** Single-pose thermal computation (steady-state).
 *  For a single torque value, compute the steady-state temperature rise.
 */
function thermalSteadyState({ torqueNm, Kt, R, R_th, T_ambK = 298.15 }) {
  const I = Kt > 1e-6 ? torqueNm / Kt : 0;
  const P = I * I * R;            // W
  const dT = P * R_th;            // K (steady-state temperature rise)
  return { I, P, T_ssK: T_ambK + dT, dT_K: dT };
}

/** Trajectory thermal model: integrate P over time, accumulate temperature with RC.
 *  This is a first-order thermal model: dT/dt = (P·R_th - (T - T_amb)) / τ_th
 *  Discretized: T_{k+1} = T_k + (dt/τ_th)·(P_k·R_th - (T_k - T_amb))
 *  Steady state: T_∞ = T_amb + P·R_th.
 */
export function thermalBudgetTrajectory({
  frames,                                  // [{ t, joints: { linkId: { tau, omega } } }]
  actuatorMap,                              // { linkId: {Kt, R, tau_th, R_th, T_maxK, T_ambK? } }
  warnMarginK = 10,                         // K below T_maxK to warn
  initialTempK = null,                     // initial motor temp (default T_ambK)
}) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return { status: "not_computed", reason: "frames array required" };
  }
  if (!actuatorMap || typeof actuatorMap !== "object") {
    return { status: "not_computed", reason: "actuatorMap required" };
  }

  const linkIds = Object.keys(actuatorMap);
  const perJoint = {};
  for (const linkId of linkIds) {
    perJoint[linkId] = {
      linkId,
      T_initialK: initialTempK || (actuatorMap[linkId].T_ambK != null ? actuatorMap[linkId].T_ambK : 298.15),
      T_maxK: actuatorMap[linkId].T_maxK,
      T_ambK: actuatorMap[linkId].T_ambK || 298.15,
      energyKJ: 0,
      T_history: [],
      P_history: [],
      frames: [],
    };
  }

  let lastT = frames[0].t;
  for (const f of frames) {
    const dt = Math.max(0.001, f.t - lastT);
    lastT = f.t;
    for (const linkId of linkIds) {
      const a = actuatorMap[linkId];
      const j = (f.joints && f.joints[linkId]) || {};
      const tau = j.tau || 0;
      const omega = j.omega || 0;
      const I = a.Kt > 1e-6 ? tau / a.Kt : 0;
      const P_cu = I * I * a.R;
      // Update temperature via first-order RC.
      const Tj = perJoint[linkId];
      const T = Tj.T_history[Tj.T_history.length - 1] || Tj.T_initialK;
      const Tnew = T + (dt / a.tau_th) * (P_cu * a.R_th - (T - (a.T_ambK || 298.15)));
      const P_total = P_cu;        // ignoring core losses
      Tj.energyKJ += P_total * dt / 1000;
      Tj.T_history.push(Tnew);
      Tj.P_history.push(P_total);
      Tj.frames.push({ t: f.t, tau, omega, I, P_W: P_total, T_K: Tnew });
    }
  }
  // Aggregate status.
  let aggregate = "ok";
  const overTemp = [];
  let totalEnergyKJ = 0;
  const result = [];
  for (const linkId of linkIds) {
    const Tj = perJoint[linkId];
    totalEnergyKJ += Tj.energyKJ;
    const Tmax = Math.max(...Tj.T_history);
    const status = Tmax > Tj.T_maxK ? "fail" : (Tmax > Tj.T_maxK - warnMarginK ? "warn" : "ok");
    if (status === "fail") { overTemp.push(linkId); aggregate = "fail"; }
    else if (status === "warn" && aggregate === "ok") { aggregate = "warn"; }
    result.push({ linkId, T_initialK: Tj.T_initialK, T_maxK: Tmax, energyKJ: Tj.energyKJ, status, frames: Tj.frames });
  }
  return { status: aggregate, perJoint: result, aggregate: { overTemp, totalEnergyKJ }, diagnostics: {frames: frames.length, joints: linkIds.length} };
}

export function thermalBudgetSingle({ torque, actuator, initialTempK = null }) {
  if (!actuator) return { status: "not_computed", reason: "actuator spec required" };
  if (!Number.isFinite(torque)) return { status: "not_computed", reason: "torque must be a number" };
  const ss = thermalSteadyState({ torqueNm: torque, ...actuator });
  const status = ss.T_ssK > (actuator.T_maxK || 0) ? "fail" : (ss.T_ssK > (actuator.T_maxK - (actuator.warnMarginK || 10)) ? "warn" : "ok");
  return { status, I: ss.I, P_W: ss.P, T_ssK: ss.T_ssK, dT_K: ss.dT_K };
}

registerSolver({
  id: "actuation.thermal-budget",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "thermal.motor-rc",
  fidelity: 1,
    // Graph-native: runs when any node carries props.actuation.thermal.
  // The props subtree is passed straight through to thermalBudgetTrajectory.
  targets: graphTargets("actuation.thermal"),
  run: graphRunner("actuation.thermal", (ctx, id, props) => envelope(thermalBudgetTrajectory(props))),
});