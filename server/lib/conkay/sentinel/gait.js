// server/lib/conkay/sentinel/gait.js
//
// Quasi-static straight-leg walk for Sentinel M1 (brief 4 item 5).
//
// This is a screen, not a logged walk. Spec 4.5 still requires a static
// joint-torque test, a logged walk, a battery rundown, and a thermal
// measurement. Passing this module is not that test.
//
// Regime: quasi-static, constant speed, straight equal links, no impact,
// angular acceleration neglected. Validity is the low-speed pose below
// (a few degrees of leg angle). It is not motion capture and it is not
// the contradicted sprint.
//
// Joint torque is the moment of body weight about the joint. Speeds of the
// ankle and the hip are the leg-angle rate with the foot flat and the torso
// upright. Knee flexion is not in the model, so knee speed and swing-leg
// energy stay unknown. The CubeMars excerpt does not state a gear ratio;
// margins are against the packaged actuator's output ratings.
//
// The design's estimated electrical profile (walkFraction 0.3, walkLoadFactor
// 0.5 of rated) is a different check. This module does not replace it and
// does not close requirement R-duration.

import { solve1D } from "../thermal/conduction.js";

export const GAIT_VERSION = "1.0.0";
export const G = 9.80665;

// Joint centres in demos/sentinel-m1.js frameModel. Lengths are those
// coordinates subtracted (computed).
export const LEG = {
  ankleZ: 0.061,
  kneeZ: 0.939,
  hipZ: 1.817,
  shinM: 0.878,
  thighM: 0.878,
  straightM: 1.756,
  source: "sentinel-m1 frameModel joint centres",
};

// CubeMars AK80-64 KV80 product-page table (northstar/sources.js, cubemars-ak80-64).
// Rated speed 48 rpm is the 48 V figure. The excerpt does not state a ratio.
export const ACTUATOR = {
  model: "CubeMars AK80-64 KV80",
  ratedTorqueNm: 48,
  peakTorqueNm: 120,
  ratedSpeedRpm48V: 48,
  voltageV: 48,
  ratedCurrentA: 7,
  envelopeM: { diameter: 0.098, length: 0.0619 },
  source: "cubemars-ak80-64",
};

export const CELL_WH = 16.2; // molicel-p45b, typical 16.2 Wh
export const PACK = { series: 13, faultParallel: 2, repairParallel: 5 };

// From the battery node: usableFraction estimated 0.8 [0.7, 0.9];
// reserveFraction 0.15 is a requirement (safe-stop, not mission energy).
export const WINDOW = {
  usable: { value: 0.8, low: 0.7, high: 0.9, state: "estimated" },
  reserve: { value: 0.15, state: "requirement" },
};

const r6 = (v) => +v.toFixed(6);

function rpmOf(omegaRadS) {
  return omegaRadS * 60 / (2 * Math.PI);
}

/** Rated-point efficiency if the table's 48 V, 7 A, 48 Nm and 48 rpm occur together. The excerpt does not say they do. */
export function ratedPointEfficiency(act = ACTUATOR) {
  const omega = act.ratedSpeedRpm48V * 2 * Math.PI / 60;
  const mechanicalW = act.ratedTorqueNm * omega;
  const electricalW = act.voltageV * act.ratedCurrentA;
  return {
    omegaRadS: omega,
    mechanicalW,
    electricalW,
    eta: mechanicalW / electricalW,
    lossW: electricalW - mechanicalW,
    state: "estimated",
    basis: "the product-page table lists rated voltage, current, torque and speed together; it does not say those four occur at one operating point",
    source: act.source,
  };
}

export function packMissionWh(parallel, { series = PACK.series, cellWh = CELL_WH, window = WINDOW } = {}) {
  const nominalWh = series * parallel * cellWh;
  const mission = (u) => nominalWh * (u - window.reserve.value);
  return {
    parallel,
    series,
    cellWh,
    cellSource: "molicel-p45b",
    nominalWh,
    missionWh: { low: mission(window.usable.low), centre: mission(window.usable.value), high: mission(window.usable.high) },
    usableState: window.usable.state,
    reserveState: window.reserve.state,
  };
}

function torqueStatus(demandLow, demandHigh, capacity) {
  const uLow = demandLow / capacity;
  const uHigh = demandHigh / capacity;
  let status = "not determined";
  if (uLow > 1) status = "FAIL";
  else if (uHigh <= 1) status = "PASS";
  return {
    demandNm: { low: r6(demandLow), high: r6(demandHigh) },
    capacityNm: capacity,
    utilization: { low: r6(uLow), high: r6(uHigh) },
    status,
  };
}

/**
 * One excursion at one mass.
 * x is the hip's forward position relative to the stance ankle.
 * Single support is the middle of the stance; double support (share 0.5) is
 * each end. Both fractions are estimated.
 */
function oneCase({ massKg, A, d, v, stanceFraction, doubleSupportFraction, eta, samples = 4000 }) {
  const L = LEG.straightM;
  const W = massKg * G;
  const singleReach = ((stanceFraction - doubleSupportFraction) / stanceFraction) * A;
  const shareAt = (x) => (Math.abs(x) <= singleReach ? 1 : 0.5);
  const lever = (x) => ({
    ankle: x + d,
    knee: x / 2 + d,
    hip: d,
  });
  const at = (x, share) => {
    const lv = lever(x);
    return { ankle: share * W * lv.ankle, knee: share * W * lv.knee, hip: share * W * lv.hip };
  };
  const peaks = {
    cycleNm: at(singleReach, 1),
    conservativeNm: at(A, 1),
  };
  const dx = (2 * A) / samples;
  let anklePosJ = 0;
  let hipPosJ = 0;
  for (let i = 0; i < samples; i++) {
    const x = -A + (i + 0.5) * dx;
    const share = shareAt(x);
    const omegaDt = dx / Math.sqrt(L * L - x * x); // ω dt, with dt = dx / v and ω = v / sqrt(...)
    const ankleJ = -share * W * (x + d) * omegaDt;
    const hipJ = -share * W * d * omegaDt;
    if (ankleJ > 0) anklePosJ += ankleJ;
    if (hipJ > 0) hipPosJ += hipJ;
  }
  const stanceS = (2 * A) / v;
  const cycleS = stanceS / stanceFraction;
  const stations = [-A, -singleReach, 0, singleReach, A].map((x) => {
    const share = shareAt(x);
    const t = at(x, share);
    const omega = v / Math.sqrt(L * L - x * x);
    return {
      xHipM: r6(x),
      support: share === 1 ? "single" : "double",
      share,
      torqueNm: { ankle: r6(t.ankle), knee: r6(t.knee), hip: r6(t.hip) },
      speedRpm: { ankle: r6(rpmOf(omega)), hip: r6(rpmOf(omega)), knee: { state: "unknown" } },
      state: "estimated",
    };
  });
  return {
    A,
    massKg,
    singleReach,
    peaks,
    ankleMotoringJ: anklePosJ,
    hipMotoringJ: hipPosJ,
    stanceS,
    cycleS,
    // Two legs each take one stance per cycle. Swing is not in the integral.
    electricalJPerCycle: 2 * (anklePosJ + hipPosJ) / eta,
    ankleLossW: (anklePosJ * (1 / eta - 1)) / cycleS,
    speedRpm: {
      mid: rpmOf(v / L),
      atExcursion: rpmOf(v / Math.sqrt(L * L - A * A)),
    },
    stations,
  };
}

function housingTemperature({ lossW, h, tInfC }) {
  const D = ACTUATOR.envelopeM.diameter;
  const Len = ACTUATOR.envelopeM.length;
  const area = Math.PI * (D / 2) ** 2;
  const perimeter = Math.PI * D;
  const lateralM2 = perimeter * Len;
  const lumpedC = tInfC + (lateralM2 > 0 ? lossW / (h * lateralM2) : NaN);
  const generation = lossW / (area * Len);
  const solve = (k) => solve1D({
    L: Len, n: 40, k, area, perimeter, hLateral: h, TinfLateral: tInfC,
    generation, left: { type: "adiabatic" }, right: { type: "adiabatic" }, steady: true,
  });
  const tK1 = solve(1).T[0];
  const tK100 = solve(100).T[0];
  return {
    hWm2K: h,
    hState: "estimated",
    tInfC,
    tInfState: "screening ambient, not a requirement and not from the datasheet",
    lumpedC: r6(lumpedC),
    solve1DC: r6(tK1),
    kDroppedOutC: r6(Math.abs(tK1 - tK100)),
    lateralM2: r6(lateralM2),
    ends: "adiabatic (the two faces of the Ф98×61.9 mm envelope are not credited with convection, so the rise is high)",
    limitC: { state: "unknown", reason: "the CubeMars excerpt states no winding or housing temperature limit" },
    status: "not determined",
  };
}

/**
 * @param {object} spec
 * @param {number} spec.massKg  total mass the stance leg is asked to carry. The
 *   pinned budget is 60.682 kg (band 60.108–61.890). Pass it in; this function
 *   does not open the design.
 */
export function quasiStaticGait({
  massKg,
  massLowKg,
  massHighKg,
  speedMs = 0.5,
  hipExcursionM = [0.12, 0.15],
  comForwardOfHipM = 0.05,
  stanceFraction = 0.6,
  doubleSupportFraction = 0.2,
  durationH = 1,
  tInfC = 25,
  hConvection = [5, 10],
  samples = 4000,
} = {}) {
  if (!(massKg > 0)) throw new Error("quasiStaticGait: massKg is required (do not call runSentinelM1 from here)");
  const lowM = massLowKg ?? massKg;
  const highM = massHighKg ?? massKg;
  const [aLow, aHigh] = hipExcursionM;
  const eff = ratedPointEfficiency();
  const common = {
    d: comForwardOfHipM, v: speedMs, stanceFraction, doubleSupportFraction, eta: eff.eta, samples,
  };
  const corners = [];
  for (const mass of [lowM, highM]) {
    for (const A of [aLow, aHigh]) corners.push(oneCase({ massKg: mass, A, ...common }));
  }
  const nominal = oneCase({ massKg, A: aHigh, ...common });
  const minOf = (fn) => Math.min(...corners.map(fn));
  const maxOf = (fn) => Math.max(...corners.map(fn));
  const rated = ACTUATOR.ratedTorqueNm;
  const peak = ACTUATOR.peakTorqueNm;
  const margins = {
    ankle: {
      rated: torqueStatus(minOf((c) => c.peaks.cycleNm.ankle), maxOf((c) => c.peaks.conservativeNm.ankle), rated),
      peak: torqueStatus(minOf((c) => c.peaks.cycleNm.ankle), maxOf((c) => c.peaks.conservativeNm.ankle), peak),
    },
    knee: {
      rated: torqueStatus(minOf((c) => c.peaks.cycleNm.knee), maxOf((c) => c.peaks.conservativeNm.knee), rated),
      peak: torqueStatus(minOf((c) => c.peaks.cycleNm.knee), maxOf((c) => c.peaks.conservativeNm.knee), peak),
    },
    hip: {
      rated: torqueStatus(minOf((c) => c.peaks.cycleNm.hip), maxOf((c) => c.peaks.conservativeNm.hip), rated),
      peak: torqueStatus(minOf((c) => c.peaks.cycleNm.hip), maxOf((c) => c.peaks.conservativeNm.hip), peak),
    },
  };
  const speedRpmHigh = maxOf((c) => c.speedRpm.atExcursion);
  const speedUtil = speedRpmHigh / ACTUATOR.ratedSpeedRpm48V;
  const elecWh = corners.map((c) => (c.electricalJPerCycle / c.cycleS) * durationH / 3600);
  const elecLow = Math.min(...elecWh);
  const elecHigh = Math.max(...elecWh);
  const lossLow = minOf((c) => c.ankleLossW);
  const lossHigh = maxOf((c) => c.ankleLossW);
  const heating = [];
  for (const h of hConvection) {
    heating.push({
      atLowLoss: housingTemperature({ lossW: lossLow, h, tInfC }),
      atHighLoss: housingTemperature({ lossW: lossHigh, h, tInfC }),
    });
  }
  const packs = {
    "13S2P": comparePack(elecHigh, packMissionWh(PACK.faultParallel)),
    "13S5P": comparePack(elecHigh, packMissionWh(PACK.repairParallel)),
  };
  return {
    version: GAIT_VERSION,
    validity: {
      regime: "quasi-static straight-leg walk; angular acceleration and impact neglected",
      angleDeg: { low: r6(Math.asin(aLow / LEG.straightM) * 180 / Math.PI), high: r6(Math.asin(aHigh / LEG.straightM) * 180 / Math.PI) },
      notAPhysicalTest: "spec 4.5: a software passage is not a logged walk, a static torque test, a rundown, or a thermal measurement",
    },
    mass: {
      kg: massKg,
      bandKg: { low: lowM, high: highM },
      state: "passed in. 60.682 kg (band 60.108–61.890) is the pinned mass budget, not a new weighing. Stance-leg self-weight is included in that total, not removed.",
    },
    kinematics: {
      speedMs: { value: speedMs, state: "estimated", basis: "low-speed walk for this screen; not a logged gait" },
      hipExcursionM: { low: aLow, high: aHigh, state: "estimated", basis: "hip travel relative to the stance ankle; step length is not measured" },
      comForwardOfHipM: { value: comForwardOfHipM, state: "estimated", basis: "50 mm, the standing holding-torque offset, applied here in the sagittal plane. The standing lever is inboard, so this is a further estimate." },
      stanceFraction: { value: stanceFraction, state: "estimated", basis: "adult walking screening fraction; no Sentinel gait log" },
      doubleSupportFraction: { value: doubleSupportFraction, state: "estimated", basis: "two double-support intervals; not measured on this machine" },
      g: G,
    },
    actuator: {
      source: ACTUATOR.source,
      model: ACTUATOR.model,
      gearRatio: { state: "unknown", status: "not determined", reason: "the CubeMars AK80-64 excerpt does not state a gear ratio. The 64 in the model name is not used as one. Sized against the packaged output ratings only." },
    },
    efficiency: eff,
    cycleAtHighExcursion: {
      massKg,
      excursionM: aHigh,
      cycleS: r6(nominal.cycleS),
      stations: nominal.stations,
      state: "estimated",
    },
    margins,
    speed: {
      ankle: {
        rpm: { low: r6(minOf((c) => c.speedRpm.mid)), high: r6(speedRpmHigh) },
        capacityRpm: ACTUATOR.ratedSpeedRpm48V,
        utilization: r6(speedUtil),
        status: speedUtil <= 1 ? "PASS" : "FAIL",
        capacityState: "sourced",
      },
      hip: {
        rpm: { low: r6(minOf((c) => c.speedRpm.mid)), high: r6(speedRpmHigh) },
        capacityRpm: ACTUATOR.ratedSpeedRpm48V,
        utilization: r6(speedUtil),
        status: speedUtil <= 1 ? "PASS" : "FAIL",
        note: "equal to the ankle rate only while the leg stays straight, the foot stays flat and the torso stays upright",
      },
      knee: { state: "unknown", status: "not determined", reason: "the straight-leg model locks the knee, so a flexion rate is not produced. Zero is not a result." },
    },
    duty: {
      description: `continuous walk at ${speedMs} m/s for ${durationH} h`,
      durationH,
      durationState: "requirement R-duration's hour, applied only to this gait",
      replacesWalkLoadFactor: false,
      note: "the assembly's walkFraction 0.3 and walkLoadFactor 0.5 of rated electrical power stay as a separate estimated profile",
    },
    energy: {
      electricalWh: { low: r6(elecLow), high: r6(elecHigh) },
      state: "computed from estimated kinematics and the estimated rated-point efficiency",
      regeneration: "not credited; the excerpt does not say the drive regenerates",
      excluded: [
        { item: "swing leg", state: "unknown" },
        { item: "knee flexion", state: "unknown" },
        { item: "compute, sensors, fans", state: "not in this integral" },
      ],
      lowerBound: true,
      packs,
      closesDurationRequirement: false,
      durationReason: "R-duration is the average load for an hour, including compute and sensors, against the electrical profile. This integral is a gait lower bound only.",
    },
    heating: {
      ankleAverageLossW: { low: r6(lossLow), high: r6(lossHigh) },
      lossState: "estimated from the rated-point efficiency applied to positive ankle work only. Absorbing work is not added: how the drive dissipates it is unknown.",
      cases: heating,
      hip: { state: "unknown", reason: "hip power is absorbing for the whole stance in this model, and dissipation of absorbing work is not in the excerpt" },
      withinStep: "steady temperature at the average loss. The step-period swing is not resolved: housing heat capacity is not in the excerpt.",
    },
  };
}

function comparePack(demandWh, pack) {
  let lowerBoundVsWindow = "not determined";
  if (demandWh > pack.missionWh.high) lowerBoundVsWindow = "FAIL";
  else if (demandWh <= pack.missionWh.low) lowerBoundVsWindow = "below the low end of the window";
  return {
    ...pack,
    demandWh: r6(demandWh),
    demandIs: "upper end of the gait lower bound, not the full load",
    lowerBoundVsWindow,
    requirementStatus: "not closed",
  };
}
