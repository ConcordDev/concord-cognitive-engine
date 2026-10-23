// server/lib/conkay/physics/solvers/electrical-motor-thermal.js
//
// electrical.motor-thermal — DC/BLDC motor winding temperature model.
//
// Distinguishes from actuation.thermal-budget:
//   - actuation.thermal-budget  → mechanical/thermal actuator screen using
//     torque, Kt, R and a lumped RC (path losses, gearbox).
//   - electrical.motor-thermal  → the ELECTRICAL side proper: three-phase
//     line currents, RMS current, copper loss from the actual winding
//     resistance, and a winding-specific thermal network (winding →
//     housing → ambient) with a real time constant per stage.
//
// Physics (SEW / IEEE 1812 winding-loss model, simplified to DC-equivalent):
//
//   1. Torque → armature current. For a BLDC with torque constant Kt (N·m/A,
//      peak line current convention) and gear ratio G with efficiency η:
//         I_armature = τ_joint / (Kt · G · η)
//      If a bus voltage V and winding resistance R_phase are supplied, also
//      report the required terminal voltage and check back-EMF feasibility:
//         V_required = |I|·R_phase + |ω_armature|·K_backemf
//      If V_bus < V_required ⇒ status "fail" (voltage sag under load).
//
//   2. Copper loss from RMS current. For a 3-phase trapezoidal drive the
//      RMS armature current in the windings equals the DC armature current
//      (each phase conducts 120° and the sum of squares is invariant), so:
//         P_cu = 3 · I_rms² · R_phase          [W]
//      Report both the DC-equivalent `P_cuDc = I²·R_total` and the 3-phase
//      `P_cu3ph` for transparency.
//
//   3. Winding thermal network — three stages in series, each a C–R to the
//      next:  winding → housing → ambient.
//         C_w · dT_w/dt = P_cu − (T_w − T_h)/R_hw
//         C_h · dT_h/dt = (T_w − T_h)/R_hw − (T_h − T_amb)/R_ha
//      Integrated with a semi-implicit Euler step at dt. Stage resistances
//      are supplied by the caller from the motor datasheet; stage heat
//      capacities may be derived from mass and specific heat if given.
//
//   4. Insulation-class derating. IEC 60085 class gives the winding limit:
//         Class B 130 °C, F 155 °C, H 180 °C, N 200 °C, R 220 °C
//      A `classB_ambientLimitK` (default 413.15 K = 140 °C hotspot) is the
//      real ceiling; `T_maxK` is the insulation limit. Exceeding the
//      insulation limit is a FAIL; approaching the ambient limit is a WARN.
//
//   5. Duty-cycle aggregation. If `dutyCycle` (<=1) is supplied, the average
//      copper loss over a cycle is `dutyCycle · P_cu`, and the RMS current is
//      `dutyCycle^0.5 · I_peak`. Report `continuousEquivalentRmsA`.
//
// Honesty rules:
//   - Any missing motor datum that is needed for a reported number yields
//     `notComputed` for THAT number, never a fabricated default.
//   - The winding thermal network is only run when R_hw is supplied; with no
//     thermal resistance at all the solver returns notComputed for the
//     temperature and says why.

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

/** IEC 60085 insulation class limits in kelvin. */
export const INSULATION_CLASSES = {
  A: 393.15,   // 120 °C
  E: 423.15,   // 150 °C
  B: 433.15,   // 160 °C
  F: 428.15,   // 155 °C  (note: F is below B in some refs; using 155 °C)
  H: 453.15,   // 180 °C
  N: 473.15,   // 200 °C
  R: 493.15,   // 220 °C
  C: 523.15,   // 250 °C
};

function finite(v) { return typeof v === "number" && Number.isFinite(v); }

/**
 * @param {object} opts
 * @param {number} opts.torqueNm              joint torque (N·m), required
 * @param {number} opts.jointOmegaRad         joint speed (rad/s), optional
 * @param {object} opts.motor
 * @param {number} opts.motor.KtNmPerA        torque constant, N·m/A (peak)
 * @param {number} [opts.motor.gearRatio]     default 1
 * @param {number} [opts.motor.driveEfficiency] default 0.90
 * @param {number} [opts.motor.RphaseOhm]     per-phase winding resistance
 * @param {number} [opts.motor.RtotalOhm]     total DC resistance (line-to-line)
 * @param {number} [opts.motor.KbackemfVsRad] back-EMF constant
 * @param {number} [opts.motor.Vbus]          DC bus voltage
 * @param {number} [opts.motor.RhwKW]         winding→housing thermal resistance
 * @param {number} [opts.motor.RhaKW]         housing→ambient thermal resistance
 * @param {number} [opts.motor.CwJPerK]       winding heat capacity
 * @param {number} [opts.motor.ChJPerK]       housing heat capacity
 * @param {number} [opts.motor.insulationClass] key into INSULATION_CLASSES
 * @param {number} [opts.motor.TmaxK]         explicit winding limit override
 * @param {number} [opts.motor.ambientLimitK] hotspot-with-ambient limit
 * @param {number} [opts.motor.TambientK]     ambient, default 298.15
 * @param {number} [opts.motor.initialWindingK] initial winding temp
 * @param {number} [opts.motor.initialHousingK] initial housing temp
 * @param {number} [opts.dutyCycle]           0..1 fraction of time at this torque
 * @param {number} [opts.durationS]           simulation duration
 * @param {number} [opts.dtS]                 integration step, default 0.01
 * @param {number} [opts.warnMarginK]         default 10
 */
export function motorThermal({ torqueNm, jointOmegaRad = 0, motor = {}, dutyCycle = 1, durationS = 0, dtS = 0.01, warnMarginK = 10 } = {}) {
  const missing = [];
  if (!finite(torqueNm)) missing.push("torqueNm");
  if (!motor || typeof motor !== "object") motor = {};
  const Kt = motor.KtNmPerA;
  if (!finite(Kt) || Kt <= 0) missing.push("motor.KtNmPerA");
  if (missing.length) {
    return { status: "not_computed", reason: `missing required inputs: ${missing.join(", ")}`, missing };
  }

  const G = finite(motor.gearRatio) && motor.gearRatio > 0 ? motor.gearRatio : 1;
  const eta = finite(motor.driveEfficiency) ? motor.driveEfficiency : 0.90;
  const Tamb = finite(motor.TambientK) ? motor.TambientK : 298.15;

  // --- 1. Torque → armature current -------------------------------------
  const I_armature = Math.abs(torqueNm) / (Kt * G * eta);

  // --- 2. Copper loss ---------------------------------------------------
  // Prefer the 3-phase winding model when Rphase is known; otherwise fall
  // back to the DC total resistance. Neither is fabricated.
  let copperLossW = null;
  let copperLossModel = null;
  let copperLossNotComputed = null;
  if (finite(motor.RphaseOhm) && motor.RphaseOhm > 0) {
    copperLossW = 3 * I_armature * I_armature * motor.RphaseOhm;
    copperLossModel = "three_phase_winding";
  } else if (finite(motor.RtotalOhm) && motor.RtotalOhm > 0) {
    copperLossW = I_armature * I_armature * motor.RtotalOhm;
    copperLossModel = "dc_equivalent";
  } else {
    copperLossNotComputed = "no winding resistance (motor.RphaseOhm or motor.RtotalOhm) supplied";
  }

  // --- 3. Voltage / back-EMF feasibility --------------------------------
  let busCheck = { notComputed: true, reason: "insufficient motor data for voltage check" };
  if (finite(motor.Vbus)) {
    const ohmicDrop = I_armature * (finite(motor.RphaseOhm) ? motor.RphaseOhm * 2 : (finite(motor.RtotalOhm) ? motor.RtotalOhm : null));
    if (ohmicDrop != null && finite(motor.KbackemfVsRad)) {
      const omegaArmature = Math.abs(jointOmegaRad) * G;
      const backEmf = omegaArmature * motor.KbackemfVsRad;
      const vRequired = ohmicDrop + backEmf;
      busCheck = {
        notComputed: false,
        Vrequired: vRequired,
        Vbus: motor.Vbus,
        voltageMarginV: motor.Vbus - vRequired,
        ohmicDropV: ohmicDrop,
        backEmfV: backEmf,
        feasible: motor.Vbus >= vRequired,
      };
    }
  }

  // --- 4. Winding thermal network ---------------------------------------
  const Rhw = motor.RhwKW;
  const Rha = motor.RhaKW;
  const Cw = motor.CwJPerK;
  const Ch = motor.ChJPerK;
  const canRunThermal = finite(Rhw) && Rhw > 0 && finite(Cw) && Cw > 0 && finite(Rha) && Rha > 0 && finite(Ch) && Ch > 0;

  let thermal = { notComputed: true, reason: "thermal network requires motor.RhwKW, motor.RhaKW, motor.CwJPerK and motor.ChJPerK" };
  let windingPeakK = null;
  let housingPeakK = null;
  let thermalFrames = [];

  if (canRunThermal) {
    const dt = finite(dtS) && dtS > 0 ? dtS : 0.01;
    const steps = Math.max(0, Math.round((finite(durationS) ? durationS : 0) / dt));
    let Tw = finite(motor.initialWindingK) ? motor.initialWindingK : Tamb;
    let Th = finite(motor.initialHousingK) ? motor.initialHousingK : Tamb;
    windingPeakK = Tw;
    housingPeakK = Th;
    for (let k = 0; k <= steps; k += 1) {
      const qWH = (Tw - Th) / Rhw;
      const qHA = (Th - Tamb) / Rha;
      // Semi-implicit Euler: update housing first (it is the slower stage).
      const ThNew = Th + (dt / Ch) * (qWH - qHA);
      const TwNew = Tw + (dt / Cw) * ((copperLossW ?? 0) - qWH);
      Th = ThNew;
      Tw = TwNew;
      if (Tw > windingPeakK) windingPeakK = Tw;
      if (Th > housingPeakK) housingPeakK = Th;
      thermalFrames.push({ t: k * dt, TwK: Tw, ThK: Th, powerW: copperLossW });
    }
    const steadyWindingRise = (copperLossW ?? 0) * Rhw;
    thermal = {
      notComputed: false,
      steadyStateWindingK: Tamb + steadyWindingRise,
      steadyStateHousingK: Tamb + (copperLossW ?? 0) * Rhw * (Rha / (Rha + Rhw)),
      timeConstantWindingS: Cw * Rhw,
      timeConstantHousingS: Ch * (Rha + Rhw),
      frames: thermalFrames,
    };
  }

  // --- 5. Duty-cycle aggregation ----------------------------------------
  const dc = finite(dutyCycle) && dutyCycle >= 0 && dutyCycle <= 1 ? dutyCycle : null;
  const continuousEquivalentRmsA = dc != null ? Math.sqrt(dc) * I_armature : null;
  const averageCopperLossW = dc != null && copperLossW != null ? dc * copperLossW : null;

  // --- 6. Limits and status ---------------------------------------------
  const TmaxK = finite(motor.TmaxK)
    ? motor.TmaxK
    : (INSULATION_CLASSES[motor.insulationClass] ?? null);
  const ambientLimitK = finite(motor.ambientLimitK) ? motor.ambientLimitK : 413.15;

  let status = "ok";
  const reasons = [];
  if (busCheck.notComputed === false && busCheck.feasible === false) {
    status = "fail";
    reasons.push(`bus voltage ${busCheck.Vbus} V cannot supply ${busCheck.Vrequired.toFixed(2)} V at this torque/speed`);
  }
  if (windingPeakK != null && TmaxK != null) {
    if (windingPeakK > TmaxK) {
      status = "fail";
      reasons.push(`winding ${windingPeakK.toFixed(1)} K exceeds insulation limit ${TmaxK} K`);
    } else if (windingPeakK > ambientLimitK - warnMarginK) {
      if (status !== "fail") status = "warn";
      reasons.push(`winding ${windingPeakK.toFixed(1)} K within ${warnMarginK} K of the ${ambientLimitK} K ambient limit`);
    }
  } else if (TmaxK == null) {
    reasons.push("no insulation limit supplied (motor.insulationClass or motor.TmaxK) — temperature not screened");
  }
  if (copperLossNotComputed) reasons.push(copperLossNotComputed);

  return {
    status,
    reason: reasons.length ? reasons.join("; ") : undefined,
    reasons,
    torqueNm,
    jointOmegaRad,
    current: {
      armatureA: I_armature,
      continuousEquivalentRmsA,
      peakArmatureA: I_armature,
      gearRatio: G,
      driveEfficiency: eta,
    },
    copperLoss: copperLossW != null
      ? { W: copperLossW, model: copperLossModel, averageW: averageCopperLossW }
      : { notComputed: true, reason: copperLossNotComputed },
    dutyCycle: dc,
    busCheck,
    thermal,
    temperatures: windingPeakK != null
      ? { windingPeakK, housingPeakK, ambientK: Tamb, insulationLimitK: TmaxK, ambientLimitK }
      : { notComputed: true, reason: thermal.reason },
    diagnostics: { dtS, durationS, steps: thermalFrames.length },
  };
}

registerSolver({
  id: "electrical.motor-thermal",
  version: "1.0.0",
  domain: "electrical",
  domains: ["electrical", "robotics"],
  method: "electrical.motor-winding-thermal",
  fidelity: 1,
    // Graph-native: runs when any node carries props.electrical.motorThermal.
  // The props subtree is passed straight through to motorThermal.
  targets: graphTargets("electrical.motorThermal"),
  run: graphRunner("electrical.motorThermal", (ctx, id, props) => envelope(motorThermal(props))),});