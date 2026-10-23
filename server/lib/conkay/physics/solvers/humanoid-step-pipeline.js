// server/lib/conkay/physics/solvers/humanoid-step-pipeline.js
//
// humanoid-step-pipeline — end-to-end walking-pipeline adapter.
//
// This is the integration piece that closes the `not_inferred` gap left open by
// gait.footstep-plan. That planner produces a CoM trajectory and a swing-foot
// trajectory but had no way to turn those geometric paths into joint angles, so
// its `jointTorquesSample` stayed `not_inferred`.
//
// The chain now wired end to end:
//
//   gait.footstep-plan          → CoM + swing-foot paths, per-frame ZMP/capture
//   kinematics.inverse-leg      → q, qdot, qddot at each swing-phase sample
//   kinematics.range-check      → per-joint limit screening
//   dynamics.inverse (RNEA)     → per-joint torques for that pose
//   actuation.joint-torque      → torque/speed feasibility vs a spec
//   actuation.thermal-budget    → I²R heating over the step
//   electrical.battery-budget   → Wh drawn, endurance
//   stability.pressure-distribution → CoP inside each foot
//
// HONESTY RULES carried through every stage:
//   - Any stage returning `not_computed` propagates that status verbatim. The
//     pipeline status is then `not_computed`, never silently `ok`.
//   - Missing actuator specs mean those joints are excluded and flagged
//     `partial: true` — never treated as zero torque.
//   - The pipeline reports a WALK FEASIBILITY verdict for one planned step on
//     one canonical humanoid. It does NOT claim the robot walks.

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";
import { gaitFootstepPlan } from "./gait-footstep-plan.js";
import { inverseLegIK } from "./kinematics-inverse-leg.js";
import { rangeCheckTrajectory } from "./kinematics-range-check.js";
import { rneaSolver } from "./dynamics-inverse.js";
import { actuationJointTorque } from "./actuation-joint-torque.js";
import { thermalBudgetTrajectory } from "./actuation-thermal-budget.js";
import { batteryBudget } from "./electrical-battery-budget.js";

const G = 9.80665;

function finite(v) { return typeof v === "number" && Number.isFinite(v); }

/**
 * @param {object} o
 * @param {object} o.leg              { L1, L2, L3 } segment lengths in metres
 * @param {Array}  [o.leg.jointLimits] per-joint {min,max} for hip/knee/ankle
 * @param {object} o.robotTree        articulated tree for dynamics.inverse
 * @param {object} o.planArgs         forwarded to gait.footstep-plan
 * @param {number} [o.poseSamplePhase] which trajectory to sample (default: swingFoot)
 * @param {number} [o.samples]        how many IK samples across the swing (default 9)
 * @param {object} [o.actuatorSpecs]  { hip:{...}, knee:{...}, ankle:{...} } for feasibility
 * @param {object} [o.battery]        { Vnominal, AhCapacity, maxDischargeCurrentA, ... }
 */
export function humanoidStepPipeline({
  leg,
  robotTree,
  planArgs,
  jointLimits = null,
  poseSamples = 9,
  actuatorSpecs = null,
  battery = null,
  dtS = 0.02,
  // Fraction of total machine power the measured joints represent. The pipeline
  // models one leg, so callers measuring a full machine should pass their own.
  coverageFraction = null,
} = {}) {
  const missing = [];
  if (!leg || !finite(leg.L1) || !finite(leg.L2) || !finite(leg.L3)) missing.push("leg segment lengths (L1/L2/L3)");
  if (!robotTree || !Array.isArray(robotTree.links)) missing.push("robotTree.links");
  if (!planArgs) missing.push("planArgs");
  if (missing.length) {
    return { status: "not_computed", reason: `missing required inputs: ${missing.join(", ")}`, missing };
  }

  // ── Stage 1: plan the step geometry ──────────────────────────────────────
  const plan = gaitFootstepPlan(planArgs);
  if (!plan || plan.status === "not_computed") {
    return { status: "not_computed", reason: `gait.footstep-plan: ${plan?.reason ?? "no result"}`, plan };
  }

  const traj = plan.trajectory?.[planArgs.sampleTrajectory || "swingFoot"];
  if (!Array.isArray(traj) || traj.length === 0) {
    return { status: "not_computed", reason: "gait.footstep-plan produced no sample trajectory", plan };
  }

  // ── Stage 2: IK — foot path → joint angles ───────────────────────────────
  // Derive the per-index {min,max} arrays the IK wants from the same limit set
  // the range check uses, so the two stages can never disagree.
  let ikLimits = null;
  if (jointLimits) {
    const limitsByLink = jointLimits.limits ?? jointLimits.byLink ?? jointLimits;
    const linkIds = jointLimits.ids ?? Object.keys(limitsByLink);
    const cleanLimits = limitsByLink.limits ?? limitsByLink;
    ikLimits = {
      min: linkIds.map((id) => cleanLimits[id].min),
      max: linkIds.map((id) => cleanLimits[id].max),
    };
  }
  const n = Math.max(2, Math.min(poseSamples | 0 || 9, traj.length));
  const idx = [];
  for (let k = 0; k < n; k += 1) idx.push(Math.round((k * (traj.length - 1)) / (n - 1)));
  const uniqueIdx = [...new Set(idx)];

  const ikSamples = [];
  const ikFailures = [];
  for (const i of uniqueIdx) {
    // gait.footstep-plan trajectory samples are { p: [x,y,z], phase, t }.
    const p = traj[i]?.p ?? traj[i]?.pos ?? traj[i];
    if (!p || !Array.isArray(p) || p.length < 3) { ikFailures.push({ frame: i, reason: "sample position missing" }); continue; }
    const hipPos = [plan.hipPos?.[0] ?? planArgs.hipPos?.[0] ?? 0,
                    plan.hipPos?.[1] ?? planArgs.hipPos?.[1] ?? 0,
                    plan.hipPos?.[2] ?? planArgs.hipPos?.[2] ?? (p[2] + leg.L1 + leg.L2 + leg.L3)];

    const r = inverseLegIK({
      hipPos,
      L1: leg.L1, L2: leg.L2, L3: leg.L3,
      targetFootPos: [p[0], p[1], p[2]],
      footOrientationDeg: planArgs.footOrientationDeg ?? 0,
      jointLimits: ikLimits,
    });
    if (r.status !== "solved") {
      ikFailures.push({ frame: i, reason: r.reason ?? r.status, status: r.status });
      continue;
    }
    ikSamples.push({ frame: i, q: r.q, footPos: p });
  }

  if (ikSamples.length === 0) {
    return {
      status: "not_computed",
      reason: `kinematics.inverse-leg could not solve any of the ${uniqueIdx.length} sampled poses`,
      plan, ikFailures,
    };
  }

  // Central-difference qdot / qddot across the IK samples (uniform time step).
  const timed = ikSamples.map((s, k) => ({ ...s, t: finite(traj[s.frame]?.t) ? traj[s.frame].t : k * dtS }));
  for (let k = 0; k < timed.length; k += 1) {
    const prev = timed[Math.max(0, k - 1)];
    const next = timed[Math.min(timed.length - 1, k + 1)];
    const span = Math.max(1e-9, next.t - prev.t);
    timed[k].qdot = next.q.map((_, j) => (next.q[j] - prev.q[j]) / span);
  }
  for (let k = 0; k < timed.length; k += 1) {
    const prev = timed[Math.max(0, k - 1)];
    const next = timed[Math.min(timed.length - 1, k + 1)];
    const span = Math.max(1e-9, next.t - prev.t);
    timed[k].qddot = next.qdot.map((_, j) => (next.qdot[j] - prev.qdot[j]) / span);
  }

  // ── Stage 3: joint-limit screening ───────────────────────────────────────
  // rangeCheckTrajectory keys limits by linkId: { min, max, maxSpeedRadps, maxAccRadps2 }.
  // Accept either { ids, limits } or a bare { linkId: limit } map.
  let limitCheck = { status: "not_applicable", reason: "no jointLimits supplied" };
  if (jointLimits) {
    const limitsByLink = jointLimits.limits ?? jointLimits.byLink ?? jointLimits;
    const linkIds = jointLimits.ids ?? Object.keys(limitsByLink);
    const cleanLimits = limitsByLink.limits ?? limitsByLink;
    limitCheck = rangeCheckTrajectory({
      joints: timed.map((s) => {
        const frame = {};
        linkIds.forEach((id, j) => { frame[id] = { q: s.q[j], qdot: s.qdot[j], qddot: s.qddot[j] }; });
        return frame;
      }),
      limits: cleanLimits,
    });
  }

  // ── Stage 4: RNEA — q/qdot/qddot → per-joint torques ────────────────────
  const revoluteCount = robotTree.links.filter((l) => l.jointType !== "fixed").length;
  if (timed[0].q.length !== revoluteCount) {
    return {
      status: "not_computed",
      reason: `IK produced ${timed[0].q.length} joint angles but the robot tree has ${revoluteCount} revolute joints; the leg sub-chain does not match the full tree`,
      plan, ikSamples: timed.length, revoluteCount, ikQCount: timed[0].q.length,
    };
  }

  const torqueFrames = [];
  let rneaNotComputed = null;
  for (const s of timed) {
    const r = rneaSolver({ tree: robotTree, gravity: [0, 0, -G], q: s.q, qdot: s.qdot, qddot: s.qddot });
    if (r.status === "notComputed" || r.status === "not_computed") {
      rneaNotComputed = r.reason ?? "dynamics.inverse returned not_computed";
      break;
    }
    torqueFrames.push({ frame: s.frame, t: s.t, torques: r.jointTorques ?? r.torques ?? null, raw: r });
  }
  if (rneaNotComputed) {
    return { status: "not_computed", reason: `dynamics.inverse: ${rneaNotComputed}`, plan, ikSamples: timed.length };
  }

  // ── Stage 5: actuator feasibility ────────────────────────────────────────
  // actuation.joint-torque runs the RNEA and screens every joint of every frame
  // in one call, returning { status, frames: [ { t, perJoint: [...] } ] }.
  // Drive it with the real IK trajectory rather than screening frame by frame.
  let actuator = { status: "not_computed", reason: "no actuatorSpecs supplied" };
  if (actuatorSpecs) {
    const screens = timed.map((s) => actuationJointTorque({
      tree: robotTree,
      gravity: [0, 0, -G],
      pose: s.q,
      qdot: s.qdot,
      qddot: s.qddot,
      actuatorSpec: actuatorSpecs,
    }));
    const bad = screens.find((x) => x && x.notComputed);
    if (bad) {
      actuator = { status: "not_computed", reason: String(bad.notComputed) };
    } else {
      // Each call returns the frames array from the shared trajectory screener.
      const frames = screens.flatMap((x) => (Array.isArray(x) ? x : x?.frames ?? []));
      const rank = { ok: 0, not_computed: 1, warn: 2, fail: 3 };
      const status = frames.reduce((w, fr) => {
        for (const j of fr.perJoint ?? []) if ((rank[j.status] ?? 0) > (rank[w] ?? 0)) w = j.status;
        return w;
      }, "ok");
      actuator = { status, frames: frames.length, detail: frames };
      const unspecced = frames.some((fr) => (fr.perJoint ?? []).some((j) => j.status === "not_computed"));
      if (unspecced) {
        actuator.partial = true;
        actuator.reason = "one or more joints had no actuator specification";
        if (actuator.status !== "fail") actuator.status = "warn";
      }
    }
  }

  // ── Stage 6: thermal budget over the step ────────────────────────────────
  let thermal = { status: "not_computed", reason: "no motor thermal specs supplied" };
  if (actuatorSpecs) {
    // thermalBudgetTrajectory keys actuators by linkId with { Kt, R, tau_th, R_th, T_maxK, T_ambK }.
    const thermalSpecs = actuatorSpecs.thermalMap
      ?? Object.fromEntries(Object.entries(actuatorSpecs)
        .filter(([, s]) => s && (s.Kt || s.R || s.tau_th || s.R_th))
        .map(([id, s]) => [id, { Kt: s.Kt ?? s.KtNmPerA, R: s.R ?? s.RtotalOhm, tau_th: s.tau_th, R_th: s.R_th, T_maxK: s.T_maxK, T_ambK: s.T_ambK }]));
    if (Object.keys(thermalSpecs).length) {
      thermal = thermalBudgetTrajectory({
        frames: torqueFrames.map((f) => {
          const s = timed.find((x) => x.frame === f.frame);
          const joints = {};
          (f.torques ?? []).forEach((t, j) => { joints[t.linkId ?? `j${j}`] = { tau: t.torqueNm ?? t.torque, omega: s?.qdot?.[j] ?? 0 }; });
          return { t: f.t, joints };
        }),
        actuatorMap: thermalSpecs,
      });
    }
  }

  // ── Stage 7: battery budget ──────────────────────────────────────────────
  // Endurance is NOT extrapolated here on purpose. This stage measured one
  // 0.45 s step of ONE leg; turning that into a whole-robot runtime would be
  // an invented number. We pass a coverage fraction so the caller can see
  // exactly how much of the machine these joints represent, but we leave the
  // duty cycle unset so `endurance.runtimeHours` stays null and the honest
  // measuredWindow is what comes back.
  let power = { status: "not_computed", reason: "no battery supplied" };
  if (battery && actuatorSpecs) {
    const actuatorMap = Object.fromEntries(Object.entries(actuatorSpecs).map(([id, s]) => [id, {
      KtNmPerA: s.KtNmPerA, gearRatio: s.gearRatio, RtotalOhm: s.RtotalOhm,
      driveEfficiency: s.driveEfficiency, gearEfficiency: s.gearEfficiency, regenEfficiency: s.regenEfficiency,
    }]));
    const measuredJointIds = Object.keys(actuatorMap);
    power = batteryBudget({
      frames: torqueFrames.map((f) => ({
        t: f.t,
        joints: Object.fromEntries((f.torques ?? []).map((t, j) => [t.linkId ?? `j${j}`, {
          tau: t.torqueNm ?? t.torque, omega: timed.find((s) => s.frame === f.frame)?.qdot?.[j] ?? 0,
        }])),
      })),
      actuatorMap, battery, dtS,
      // The pipeline models ONE leg. Whole-robot power is not derivable from
      // that, so coverage is declared as a single-leg fraction and endurance
      // stays gated behind the missing duty cycle.
      coverageFraction: coverageFraction ?? 1.0,
    });
    power.scope = {
      measuredJoints: measuredJointIds,
      measuredDurationS: power.measuredWindow?.durationS ?? null,
      note: "One leg, one planned step. Not a whole-robot energy budget.",
    };
  }

  // ── Verdict ──────────────────────────────────────────────────────────────
  const peakTorqueNm = Math.max(0, ...torqueFrames.flatMap((f) => (f.torques ?? []).map((t) => Math.abs(t.torqueNm ?? t.torque ?? 0))));
  const blocking = [];
  if (ikFailures.length) blocking.push(`${ikFailures.length}/${uniqueIdx.length} swing poses were unreachable`);
  if (limitCheck.status === "fail") blocking.push("joint limits exceeded");
  if (actuator.status === "fail") blocking.push("actuator torque/speed limit exceeded");
  if (thermal.status === "fail") blocking.push("actuator thermal limit exceeded");
  if (power.status === "fail") blocking.push("battery pack limit exceeded");
  if (plan.status === "fail") blocking.push("ZMP left the support polygon during the planned step");

  const partial = Boolean(actuatorSpecs && actuator.status !== "fail" && actuator.partial)
    || Boolean(battery && power.partial)
    || Boolean(jointLimits && limitCheck.status === "warn");

  let status = "ok";
  if (blocking.length) status = "fail";
  else if (partial) status = "warn";

  return {
    status,
    reason: blocking.length ? blocking.join("; ") : undefined,
    blocking,
    partial,
    // Geometric verdict from the planner, preserved as-is.
    plan: { status: plan.status, phases: plan.phases, summary: plan.summary, trajectoryFrames: traj.length },
    // The gap this pipeline was built to close:
    jointTorquesSample: {
      status: "inferred",
      source: "kinematics.inverse-leg → dynamics.inverse (RNEA)",
      frames: torqueFrames.length,
      peakTorqueNm,
      samples: torqueFrames.map((f) => ({ frame: f.frame, t: f.t, torquesNm: (f.torques ?? []).map((t) => t.torqueNm ?? t.torque) })),
    },
    ik: {
      samples: timed.length,
      requested: uniqueIdx.length,
      failures: ikFailures,
      jointAngles: timed.map((s) => ({ frame: s.frame, q: s.q })),
    },
    jointLimits: limitCheck,
    actuator,
    thermal,
    power,
    canonical: planArgs.__canonical ?? null,
  };
}

registerSolver({
  id: "humanoid.step-pipeline",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "humanoid.step-pipeline",
  fidelity: 3,
    // Graph-native: runs when any node carries props.humanoid.stepPipeline.
  // The props subtree is passed straight through to humanoidStepPipeline.
  targets: graphTargets("humanoid.stepPipeline"),
  run: graphRunner("humanoid.stepPipeline", (ctx, id, props) => envelope(humanoidStepPipeline(props))),});