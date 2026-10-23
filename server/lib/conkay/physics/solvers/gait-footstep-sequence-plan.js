// server/lib/conkay/physics/solvers/gait-footstep-sequence-plan.js
//
// gait.footstep-sequence-plan — plan N successive footsteps with ICP handoff.
//
// Builds on gait.footstep-plan: each step's terminal ICP is used to derive
// the next step's required initial ICP via the inverse LIPM relation:
//   p_icp[k+1] = p_zmp[k] + (p_icp[k] - p_zmp[k]) · exp(-ω·T)
//
// Solver input:
//   steps: [{ foot: "L"|"R", targetFootPos: [x,y,z], supportFootPos: [x,y,z], durationS: number }]
//   startCom: { p:[x,y,z], v:[vx,vy,vz] }
//   comHeight: z_c
//   samplePeriod: dt (s)
//
// Output:
//   trajectory: [{t, com:[x,y,z], icp:[x,y], stepIndex, status}]
//   perStepSummary: [{stepIndex, foot, terminalIcp, icpErrorM, status}]

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const G = 9.80665;

/** Forward ICP evolution: icp[k+1] = zmp[k] + (icp[k] - zmp[k]) · exp(-ω·T) */
function evolveIcpForward(icpStart, zmp, omegaT) {
  const d = Math.exp(-omegaT);
  return [zmp[0] + (icpStart[0] - zmp[0]) * d, zmp[1] + (icpStart[1] - zmp[1]) * d];
}

/** Inverse: icp_start = zmp + (icp_end - zmp) / exp(-ω·T) */
function inverseIcpForTarget(icpEnd, zmp, omegaT) {
  const d = Math.exp(-omegaT);
  return [zmp[0] + (icpEnd[0] - zmp[0]) / d, zmp[1] + (icpEnd[1] - zmp[1]) / d];
}

/** LIPM analytic CoM evolution. */
function lipmComAtTime(com0, vel0, zmp, omega0, t) {
  const dz = [com0[0] - zmp[0], com0[1] - zmp[1]];
  const ch = Math.cosh(omega0 * t);
  const sh = Math.sinh(omega0 * t) / omega0;
  return [zmp[0] + dz[0] * ch + vel0[0] * sh, zmp[1] + dz[1] * ch + vel0[1] * sh];
}

export function footstepSequencePlan({ steps, startCom = { p: [0, 0, 0.945], v: [0, 0, 0] }, comHeight = 0.945, samplePeriod = 0.05 }) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { status: "not_computed", reason: "steps array required" };
  }
  const omega0 = Math.sqrt(G / comHeight);
  const trajectory = [];
  const perStepSummary = [];

  let curCom = startCom.p.slice();
  let curVel = startCom.v ? startCom.v.slice() : [0, 0, 0];
  let curIcp = [curCom[0] + curVel[0] / omega0, curCom[1] + curVel[1] / omega0];

  let totalSteps = 0, okSteps = 0;
  let tNow = 0;
  let aggregateStatus = "ok";

  for (let k = 0; k < steps.length; k += 1) {
    const step = steps[k];
    const stepDuration = step.durationS || 0.5;
    const supportPos = step.supportFootPos || [0, 0, 0];
    const stepFoot = step.foot || "R";
    const targetFoot = step.targetFootPos;

    const omegaT = omega0 * stepDuration;

    // Target ICP at end of step: by convention, place it at the support-foot
    // position (steady-state on support). For "next foot target" pattern, use
    // midpoint between current support and next target.
    const targetIcp = [
      (supportPos[0] + (targetFoot ? targetFoot[0] : supportPos[0])) * 0.5,
      (supportPos[1] + (targetFoot ? targetFoot[1] : supportPos[1])) * 0.5,
    ];

    // Required initial ICP for this step (inverse evolution):
    const requiredInitialIcp = inverseIcpForTarget(targetIcp, supportPos, omegaT);
    // ICP-error: how far is the current ICP from the required.
    const icpErr = Math.sqrt((requiredInitialIcp[0] - curIcp[0]) ** 2 + (requiredInitialIcp[1] - curIcp[1]) ** 2);

    const status = icpErr < 0.4 ? "ok" : "fail";
    totalSteps += 1;
    if (status === "ok") okSteps += 1; else aggregateStatus = "fail";

    // CoM trajectory during this step.
    const stepStartCom = curCom.slice();
    const stepStartVel = curVel.slice();
    const N = Math.max(2, Math.round(stepDuration / samplePeriod));
    for (let s = 0; s <= N; s += 1) {
      const tt = (s / N) * stepDuration;
      const comTT = lipmComAtTime(stepStartCom, stepStartVel, supportPos, omega0, tt);
      trajectory.push({ t: tNow + tt, com: comTT.slice(), stepIndex: k, status });
    }
    // Terminal CoM via LIPM analytic:
    curCom = lipmComAtTime(stepStartCom, stepStartVel, supportPos, omega0, stepDuration);
    curCom.push = undefined;      // suppress
    curCom[2] = comHeight;
    // Cur velocity at end of step: ċ(t) = ω·sinh(ωt)·(com0 − zmp) + cosh(ωt)·vel0
    const dz = [stepStartCom[0] - supportPos[0], stepStartCom[1] - supportPos[1]];
    const chT = Math.cosh(omegaT);
    const shT = Math.sinh(omegaT);
    curVel = [
      omega0 * shT * dz[0] + chT * stepStartVel[0],
      omega0 * shT * dz[1] + chT * stepStartVel[1],
      0,
    ];
    // Terminal ICP.
    curIcp = evolveIcpForward(curIcp, supportPos, omegaT);

    perStepSummary.push({
      stepIndex: k,
      foot: stepFoot,
      supportFoot: step.foot === "R" ? "L" : "R",
      supportPos,
      targetFootPos: targetFoot,
      stepDurationS: stepDuration,
      initialIcp: curIcp.slice(),
      targetIcp,
      icpErrorM: icpErr,
      requiredInitialIcp,
      status,
    });
    tNow += stepDuration;
  }

  if (aggregateStatus === "ok" && okSteps > 0 && okSteps < totalSteps) aggregateStatus = "warn";
  return {
    status: aggregateStatus,
    trajectory,
    perStepSummary,
    finalIcp: curIcp,
    aggregate: { totalSteps, okSteps },
    diagnostics: { comHeight, omega0, samplePeriod },
  };
}

registerSolver({
  id: "gait.footstep-sequence-plan",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "gait.lipm-multi-step",
  fidelity: 1,
    // Graph-native: runs when any node carries props.gait.footstepSequence.
  // The props subtree is passed straight through to footstepSequencePlan.
  targets: graphTargets("gait.footstepSequence"),
  run: graphRunner("gait.footstepSequence", (ctx, id, props) => envelope(footstepSequencePlan(props))),});