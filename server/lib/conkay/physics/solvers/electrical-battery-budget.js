// server/lib/conkay/physics/solvers/electrical-battery-budget.js
//
// electrical.battery-budget — energy/power budget for a mechanism over a
// motion profile.
//
// Turns per-frame joint torques into an electrical energy budget using a real
// motor-efficiency model, then checks that budget against a battery pack.
//
// Electrical model (per joint, per frame):
//
//   1. Armature current from torque, through the gearbox:
//
//        I_motor = |τ_joint| / (Kt · G · η_drive)
//
//   2. Copper loss in the winding (DC-equivalent total resistance):
//
//        P_cu = I_motor² · R_total
//
//   3. Mechanical output power at the joint:
//
//        P_mech = τ_joint · ω_joint
//
//   4. Electrical input power, using the drive-efficiency model:
//
//        P_elec = max( |P_mech| / η_total , P_cu )
//
//      The max() is essential: a holding torque at zero speed still draws
//      current, so the copper loss sets a floor. A pure-torque/ω model would
//      report zero draw for an isometric hold, which is physically wrong.
//
//   5. Regen: when the joint is being back-driven the drive can push energy
//      back into the pack, but only up to the drive's regen efficiency and
//      never below the copper loss:
//
//        P_regen = |P_mech| · η_regen, capped at (P_elec − P_cu)
//
//      Regen is reported separately and only counted against the battery when
//      `countRegen` is true, because whether it actually recovers depends on
//      the drive topology.
//
// Battery model:
//
//   E_total   = V_nominal · Ah_capacity
//   P_peak    = V_nominal · maxDischargeCurrentA
//   V_nominal · I_drawn > P_peak  ⇒  voltage sag / brown-out ⇒ FAIL
//   E_drawn > E_total · depthOfDischargeLimit  ⇒  run-time exhausted ⇒ FAIL
//
// Honesty rules:
//   - Missing Kt / gear ratio / resistance for a joint that actually carries
//     torque ⇒ that joint reports `notComputed` and is excluded from the
//     totals, which are flagged `partial: true`. It is never assumed to be
//     zero.
//   - Frames with missing torque or omega are counted and reported, not
//     silently treated as zero.

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const G = 9.80665;   // exported for symmetry with sibling solvers

function finite(v) { return typeof v === "number" && Number.isFinite(v); }

/**
 * @param {object} opts
 * @param {Array} opts.frames               [{ t, durationS?, joints: { id: { tau, omega } } }]
 * @param {object} opts.actuatorMap        { jointId: { KtNmPerA, gearRatio, driveEfficiency,
 *                                                    RtotalOhm, regenEfficiency?, maxContinuousTorqueNm? } }
 * @param {object} opts.battery            { Vnominal, AhCapacity, maxDischargeCurrentA,
 *                                           depthOfDischargeLimit? , massKg? }
 * @param {number} [opts.dtS]              default frame duration when a frame omits it
 * @param {boolean} [opts.countRegen]      default false
 */
export function batteryBudget({
  frames, actuatorMap, battery, dtS = 0.02, countRegen = false,
  // Endurance gating: how often this motion actually repeats, and what share
  // of the machine these joints represent. Omit either and endurance is
  // reported as null alongside the measured window instead.
  dutyCycle = null, cycleSeconds = null,
  // Fraction of TOTAL machine power these measured joints account for.
  // Defaults to 1.0 (the actuatorMap is the whole machine). Set it lower when
  // profiling only part of the robot.
  coverageFraction = 1.0,
} = {}) {
  const missing = [];
  if (!Array.isArray(frames) || frames.length === 0) missing.push("frames");
  if (!actuatorMap || typeof actuatorMap !== "object") missing.push("actuatorMap");
  if (!battery || typeof battery !== "object") missing.push("battery");
  if (missing.length) {
    return { status: "not_computed", reason: `missing required inputs: ${missing.join(", ")}`, missing };
  }

  const V = battery.Vnominal;
  const Ah = battery.AhCapacity;
  const Imax = battery.maxDischargeCurrentA;
  const numericMissing = [];
  if (!finite(V) || V <= 0) numericMissing.push("battery.Vnominal");
  if (!finite(Ah) || Ah <= 0) numericMissing.push("battery.AhCapacity");
  if (!finite(Imax) || Imax <= 0) numericMissing.push("battery.maxDischargeCurrentA");
  if (numericMissing.length) {
    return { status: "not_computed", reason: `missing or invalid battery data: ${numericMissing.join(", ")}`, missing: numericMissing };
  }

  const dod = finite(battery.depthOfDischargeLimit) ? battery.depthOfDischargeLimit : 0.80;
  const E_totalWh = V * Ah;
  const E_usableWh = E_totalWh * dod;
  const P_peakW = V * Imax;

  // Per-joint accumulators.
  const jointIds = Object.keys(actuatorMap);
  const perJoint = {};
  for (const id of jointIds) {
    perJoint[id] = {
      jointId: id,
      energyInWh: 0,
      grossInWh: 0,
      energyOutWh: 0,
      energyNetWh: 0,
      copperLossWh: 0,
      mechOutWh: 0,
      peakPowerW: 0,
      peakCurrentA: 0,
      notComputed: { reason: null, frameCount: 0 },
      specMissing: null,
    };
  }

  let peakPowerW = 0;
  let peakPowerTimeS = 0;
  let incompleteFrames = 0;
  let lastT = finite(frames[0]?.t) ? frames[0].t : 0;
  let totalDurationS = 0;

  for (const f of frames) {
    const t = finite(f.t) ? f.t : lastT;
    const dt = finite(f.durationS) ? f.durationS : (finite(f.t) && t > lastT ? t - lastT : dtS);
    lastT = t;
    totalDurationS += dt;

    let framePowerW = 0;
    let frameOk = true;
    const joints = f.joints && typeof f.joints === "object" ? f.joints : {};

    for (const id of jointIds) {
      const act = actuatorMap[id] || {};
      const j = joints[id];

      // Spec completeness check (done once, cached).
      if (perJoint[id].specMissing === null) {
        const absent = [];
        if (!finite(act.KtNmPerA) || act.KtNmPerA <= 0) absent.push("KtNmPerA");
        if (!finite(act.RtotalOhm) || act.RtotalOhm <= 0) absent.push("RtotalOhm");
        if (!finite(act.gearRatio) || act.gearRatio <= 0) absent.push("gearRatio");
        perJoint[id].specMissing = absent.length ? absent : null;
      }
      if (perJoint[id].specMissing) {
        perJoint[id].notComputed.frameCount += 1;
        frameOk = false;
        continue;
      }

      // No command for this joint this frame ⇒ idle, zero current.
      if (!j || (!finite(j.tau) && !finite(j.omega))) continue;
      const tau = finite(j.tau) ? j.tau : 0;
      const omega = finite(j.omega) ? j.omega : 0;

      const G_ = act.gearRatio;
      const etaDrive = finite(act.driveEfficiency) ? act.driveEfficiency : 0.90;
      const etaGear = finite(act.gearEfficiency) ? act.gearEfficiency : 0.95;
      const I = Math.abs(tau) / (act.KtNmPerA * G_ * etaDrive);
      const Pcu = I * I * act.RtotalOhm;
      const Pmech = tau * omega;
      // Mechanical output the drive must push through BOTH the gearbox and the
      // drive electronics to get this much power out at the joint.
      const Pdrive = Math.abs(Pmech) / (etaDrive * etaGear);

      // Copper loss is a floor the drive can never avoid: current flows whenever
      // a torque is held, even at zero speed. An isometric hold therefore still
      // draws Pcu watts, not zero.
      const PelecBase = Math.max(Pdrive, Pcu);

      // Regeneration: the drive can push some of the mechanical energy back
      // into the pack, at the regen efficiency. It can never exceed the power
      // actually flowing through the gearbox, and the unavoidable copper loss
      // is always still drawn from the pack.
      const regenEff = finite(act.regenEfficiency) ? act.regenEfficiency : 0.60;
      const Pgen = (Pmech < 0) ? Pdrive * regenEff : 0;

      // Net electrical draw this frame. Regen reduces it but the copper loss
      // is a hard floor, so Pelec is always >= Pcu >= 0 and the pack can never
      // appear to gain energy from nothing.
      const Pelec = Math.max(Pcu, PelecBase - Pgen);

      perJoint[id].energyInWh += Pelec * dt / 3600;
      perJoint[id].grossInWh += PelecBase * dt / 3600;
      perJoint[id].energyOutWh += Pgen * dt / 3600;
      perJoint[id].copperLossWh += Pcu * dt / 3600;
      perJoint[id].mechOutWh += Math.abs(Pmech) * dt / 3600;
      perJoint[id].energyNetWh += (Pelec - Pgen) * dt / 3600;
      framePowerW += Pelec;

      if (Pelec > perJoint[id].peakPowerW) perJoint[id].peakPowerW = Pelec;
      if (I > perJoint[id].peakCurrentA) perJoint[id].peakCurrentA = I;
    }

    if (!frameOk) incompleteFrames += 1;
    if (framePowerW > peakPowerW) { peakPowerW = framePowerW; peakPowerTimeS = t; }
  }

  // Totals.
  const joints = [];
  let energyInWh = 0;
  let grossInWh = 0;
  let energyOutWh = 0;
  let copperLossWh = 0;
  let mechOutWh = 0;
  let partial = false;
  const unresolved = [];
  for (const id of jointIds) {
    const a = perJoint[id];
    if (a.specMissing) {
      partial = true;
      unresolved.push({ jointId: id, missing: a.specMissing, framesAffected: a.notComputed.frameCount });
    }
    energyInWh += a.energyInWh;
    grossInWh += a.grossInWh;
    energyOutWh += a.energyOutWh;
    copperLossWh += a.copperLossWh;
    mechOutWh += a.mechOutWh;
    joints.push({
      jointId: id,
      energyInWh: a.energyInWh,
      grossEnergyInWh: a.grossInWh,
      regenCreditWh: a.grossInWh - a.energyInWh,
      energyOutWh: a.energyOutWh,
      energyNetWh: a.energyNetWh,
      copperLossWh: a.copperLossWh,
      mechOutWh: a.mechOutWh,
      peakPowerW: a.peakPowerW,
      peakCurrentA: a.peakCurrentA,
      notComputed: a.specMissing
        ? { reason: `missing actuator spec: ${a.specMissing.join(", ")}`, framesAffected: a.notComputed.frameCount }
        : undefined,
    });
  }

  // Net electrical energy drawn from the pack.
  //
  // `energyInWh` is already net of regen frame-by-frame: each frame's Pelec was
  // floored at the copper loss after subtracting Pgen. `grossInWh` is what the
  // drive would have drawn with no regen at all, so
  //     regenCreditWh = grossInWh - netInWh
  // is the energy actually returned to the pack. When `countRegen` is false the
  // credit is still reported (it is a physical measurement) but the endurance
  // figures use the conservative no-regen total.
  const energyDrawWh = countRegen ? energyInWh : grossInWh;
  const recoveredWh = grossInWh - energyInWh;
  const peakCurrentA = peakPowerW / V;
  // energyDrawWh is in watt-hours, so converting to watts requires ×3600.
  // (Wh/s is not W — this was the first version of this figure and it was
  // off by a factor of 3600.)
  const meanPowerW = totalDurationS > 0 ? (energyDrawWh * 3600) / totalDurationS : null;

  // ENDURANCE EXTRAPOLATION — deliberately gated.
  //
  // Dividing a whole pack by the energy of one measured window produces a
  // number, but that number is only meaningful if the window is representative
  // of how long the robot will actually be doing that thing. A 0.45 s single
  // step of one leg is NOT representative of continuous walking.
  //
  // So: endurance is reported ONLY when the caller supplies a duty cycle that
  // says how often this activity repeats. `dutyCycle` is the fraction of total
  // time spent in this motion (e.g. 0.35 for a gait cycle that walks 35% of
  // the time). `cycleSeconds` is the length of that cycle. Together they give:
  //
  //     averagePowerW = meanPowerW * (windowS / cycleSeconds) * dutyCycle
  //
  // There is a second gate, and it matters just as much: these figures are
  // only a whole-robot figure if EVERY energy consumer was measured. A single
  // leg does not account for the other leg, the torso, the arms, the head, or
  // any standby draw. `coverageFraction` is the caller's statement of what
  // fraction of total machine power these measured joints represent; if it is
  // not supplied we assume 1.0 only because the caller says the actuatorMap is
  // the complete machine — otherwise endurance stays null with a reason.
  //
  // Without these, we report the measured window and refuse to extrapolate.
  const hasDutyCycle = finite(dutyCycle) && dutyCycle > 0 && dutyCycle <= 1
    && finite(cycleSeconds) && cycleSeconds > 0;
  const hasCoverage = finite(coverageFraction) && coverageFraction > 0 && coverageFraction <= 1;

  let runtimeHours = null;
  let repeatableRuns = null;
  let extrapolationBasis = "measured_window_only";
  const blockReasons = [];

  if (!hasDutyCycle) blockReasons.push("no dutyCycle/cycleSeconds supplied");
  if (!hasCoverage) blockReasons.push(`coverageFraction ${coverageFraction} is not a valid fraction of total machine power`);

  if (hasDutyCycle && hasCoverage) {
    // Share of a real cycle this window occupies, scaled to whole-machine power.
    const cycleFraction = (totalDurationS / cycleSeconds) * dutyCycle;
    const averagePowerW = meanPowerW !== null ? (meanPowerW / coverageFraction) * cycleFraction : null;
    runtimeHours = averagePowerW && averagePowerW > 0 ? E_usableWh / averagePowerW : null;
    repeatableRuns = energyDrawWh > 0
      ? (E_usableWh / energyDrawWh) * (1 / Math.max(1e-12, cycleFraction))
      : null;
    extrapolationBasis = "duty_cycle";
  }

  // Always report what was actually measured, so a caller can see the window
  // behind any extrapolation instead of taking a derived figure on faith.
  const measuredWindow = {
    durationS: totalDurationS,
    energyWh: energyDrawWh,
    meanPowerW,
    peakPowerW,
    frames: frames.length - incompleteFrames,
    framesEvaluated: frames.length,
  };

  const extrapolationCaveat = extrapolationBasis === "duty_cycle"
    ? null
    : `Endurance is not extrapolated (${blockReasons.join("; ")}). The measured window is only ` +
      `${totalDurationS.toFixed(2)} s of one activity, so dividing a whole pack by it would not be ` +
      `representative. Supply dutyCycle + cycleSeconds (and coverageFraction if these joints are ` +
      `not the whole machine), or read measuredWindow directly.`;

  let status = "ok";
  const reasons = [];
  if (partial) {
    status = "warn";
    reasons.push(`${unresolved.length} joint(s) had incomplete actuator specs and were excluded from the totals`);
  }
  if (incompleteFrames > 0) {
    reasons.push(`${incompleteFrames} of ${frames.length} frames could not be fully evaluated`);
  }
  if (peakPowerW > P_peakW) {
    status = "fail";
    reasons.push(`peak electrical draw ${peakPowerW.toFixed(1)} W exceeds the pack limit ${P_peakW.toFixed(1)} W`);
  }
  if (energyDrawWh > E_usableWh) {
    status = "fail";
    reasons.push(`energy draw ${energyDrawWh.toFixed(4)} Wh exceeds usable capacity ${E_usableWh.toFixed(4)} Wh`);
  }

  return {
    status,
    reason: reasons.length ? reasons.join("; ") : undefined,
    reasons,
    partial,
    unresolvedJoints: unresolved,
    battery: {
      Vnominal: V,
      AhCapacity: Ah,
      maxDischargeCurrentA: Imax,
      depthOfDischargeLimit: dod,
      energyTotalWh: E_totalWh,
      energyUsableWh: E_usableWh,
      peakPowerLimitW: P_peakW,
    },
    totals: {
      energyDrawWh,
      energyInWh,
      grossEnergyInWh: grossInWh,
      energyRecoveredWh: recoveredWh,
      copperLossWh,
      mechanicalOutWh: mechOutWh,
      conversionEfficiency: mechOutWh > 0 ? mechOutWh / energyInWh : null,
      peakPowerW,
      peakCurrentA,
      peakPowerTimeS,
      durationS: totalDurationS,
      framesEvaluated: frames.length - incompleteFrames,
      framesTotal: frames.length,
    },
    endurance: {
      runtimeHours,
      repeatableRuns,
      extrapolationBasis,
      caveat: extrapolationCaveat,
      blockedBy: blockReasons,
      dutyCycle: hasDutyCycle ? dutyCycle : null,
      cycleSeconds: hasDutyCycle ? cycleSeconds : null,
      coverageFraction: hasCoverage ? coverageFraction : null,
    },
    measuredWindow,
    perJoint: joints,
    countRegen,
  };
}

registerSolver({
  id: "electrical.battery-budget",
  version: "1.0.0",
  domain: "electrical",
  domains: ["electrical", "robotics"],
  method: "electrical.battery-energy-budget",
  fidelity: 1,
    // Graph-native: runs when any node carries props.electrical.batteryBudget.
  // The props subtree is passed straight through to batteryBudget.
  targets: graphTargets("electrical.batteryBudget"),
  run: graphRunner("electrical.batteryBudget", (ctx, id, props) => envelope(batteryBudget(props))),});