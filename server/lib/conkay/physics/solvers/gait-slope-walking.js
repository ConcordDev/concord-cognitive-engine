// server/lib/conkay/physics/solvers/gait-slope-walking.js
//
// gait.slope-walking — walkable slope limits + required ZMP shift for a biped
// standing on an inclined surface.
//
// Two failure modes bound the walkable slope for a static single-support pose:
//
//   1. Slipping at the foot. The horizontal vs normal force ratio the foot
//      needs to support the body on a slope of angle θ is tan(θ). Slip begins
//      when tan(θ) exceeds the available friction coefficient μ.
//        ⇒ criticalSlipDeg = atan(μ) · 180/π
//
//   2. Tipping about the toe / heel. The body CoM is a horizontal distance
//      `comOffsetFromAnkleM` in front of the ankle and a vertical distance
//      `comHeight` above it. Projecting that onto the slope gives a foot-along
//      offset of  comOffset·cos(θ) + comHeight·sin(θ).  Tipping begins when
//      this offset equals the foot half-length (footLengthM/2).
//
//      Solve   A·cos(θ) + B·sin(θ) = C     A = comOffset, B = comHeight, C = footLengthM/2
//      via     R = hypot(A, B),  φ = atan2(B, A),  cos(θ − φ) = C / R
//      giving  θ = φ ± acos(C / R).  Take the FIRST POSITIVE solution.
//      If  C/R > 1  there is no tipping solution — set tippingSlipDeg = null
//      and report that the foot never tips at any slope (foot is too long
//      relative to the body).
//
// Required ZMP shift on a slope:
//   requiredZmpShiftM = comOffset − (footLengthM / 2) · cos(θ) + comHeight · sin(θ)
//   This is the front-of-foot offset the ZMP must take to balance the down-slope
//   gravity component on a foot whose contact patch is cos(θ) shorter than flat.
//   Reported only when slopeDeg is supplied; numeric otherwise.
//
// Inputs:
//   comHeight              — m, vertical CoM height above the ankle  (required)
//   footLengthM            — m, foot length (heel-to-toe)           (required)
//   footWidthM             — m, optional (informational)
//   frictionCoefficient    — μ, foot–ground friction                (default 0.6)
//   slopeDeg               — deg, surface slope (positive = uphill); optional
//   comOffsetFromAnkleM    — m, horizontal CoM offset from ankle;  required when slopeDeg given
//
// Output (always returned):
//   { status, reason, slopeDeg, criticalSlipDeg, tippingSlipDeg,
//     walkableSlopeDeg, slipOk, tipOk, requiredZmpShiftM, slopeMarginDeg,
//     comHeight, footLengthM, footWidthM, frictionCoefficient }

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const G = 9.80665;
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const EPS = 1e-12;

/**
 * @param {object} opts
 * @param {number} opts.comHeight                m, vertical CoM above ankle (required)
 * @param {number} opts.footLengthM              m, foot length, heel-to-toe (required)
 * @param {number} [opts.footWidthM=0]           m, foot width (informational)
 * @param {number} [opts.frictionCoefficient=0.6] μ, foot–ground friction
 * @param {number|null} [opts.slopeDeg=null]      deg, surface slope (positive = uphill)
 * @param {number|null} [opts.comOffsetFromAnkleM=null] m, horizontal CoM offset from ankle
 */
export function slopeWalking({
  comHeight,
  footLengthM,
  footWidthM = 0,
  frictionCoefficient = 0.6,
  slopeDeg = null,
  comOffsetFromAnkleM = null,
} = {}) {
  // --- Validate required inputs ------------------------------------------------
  if (!Number.isFinite(comHeight) || comHeight <= 0) {
    return notComputed("comHeight");
  }
  if (!Number.isFinite(footLengthM) || footLengthM <= 0) {
    return notComputed("footLengthM");
  }
  if (!Number.isFinite(frictionCoefficient) || frictionCoefficient <= 0) {
    return {
      status: "not_computed",
      reason: "frictionCoefficient must be a positive finite number",
      slopeDeg: null,
      criticalSlipDeg: null,
      tippingSlipDeg: null,
      walkableSlopeDeg: null,
      slipOk: null,
      tipOk: null,
      requiredZmpShiftM: null,
      slopeMarginDeg: null,
      comHeight,
      footLengthM,
      footWidthM,
      frictionCoefficient,
    };
  }

  const slopeSupplied = slopeDeg != null;
  if (slopeSupplied) {
    if (!Number.isFinite(comOffsetFromAnkleM)) {
      return notComputedWithLimits("comOffsetFromAnkleM", comHeight, footLengthM, footWidthM, frictionCoefficient, slopeDeg);
    }
  }

  // --- Critical slopes (always computed) --------------------------------------
  // 1. Slip limit  — μ = tan(θ_critical)  ⇒  θ_critical = atan(μ).
  const criticalSlipDeg = Math.atan(frictionCoefficient) * RAD_TO_DEG;

  // 2. Tipping limit — solve A·cos θ + B·sin θ = C for the first positive θ.
  //    A = comOffset, B = comHeight, C = footLengthM / 2.
  //    In a no-slope call comOffsetFromAnkleM may legitimately be null — tip
  //    the equation back to A = 0 in that case (the foot still has a tipping
  //    limit, it just uses the CoM's vertical offset alone).
  const A = Number.isFinite(comOffsetFromAnkleM) ? comOffsetFromAnkleM : 0;
  const B = comHeight;
  const C = footLengthM / 2;
  let tippingSlipDeg = null;
  let tippingNote = null;
  const ratioCR = C / Math.hypot(A, B);
  if (ratioCR >= 1 - EPS) {
    // Foot is long enough that the CoM never projects outside the support
    // polygon. The biped can stand on this foot at any slope without tipping.
    tippingSlipDeg = null;
    tippingNote = "foot never tips at any slope — C/R >= 1, CoM always inside support polygon";
  } else {
    const phi = Math.atan2(B, A);            // radians, in (−π, π]
    const acosArg = Math.min(1, Math.max(-1, ratioCR));
    const acosVal = Math.acos(acosArg);      // radians
    // Two roots of cos(θ − φ) = C/R:  θ = φ + acosVal  or  θ = φ − acosVal.
    // Pick the FIRST POSITIVE one (smallest θ > 0). This is the slope at which
    // the CoM first reaches the toe.
    const candidates = [phi + acosVal, phi - acosVal];
    let firstPositive = null;
    for (const t of candidates) {
      if (t > EPS && (firstPositive == null || t < firstPositive)) firstPositive = t;
    }
    if (firstPositive == null) {
      // Both roots are ≤ 0 — degenerate. No forward tipping; report null.
      tippingSlipDeg = null;
      tippingNote = "no positive tipping root — CoM is initially behind the ankle";
    } else {
      tippingSlipDeg = firstPositive * RAD_TO_DEG;
    }
  }

  // walkableSlopeDeg = the binding critical slope. If both limits are known
  // it is min(slip, tip). If only one is known, that one binds. If neither
  // is finite (only slipping when μ = ∞ would that happen — bounded here by
  // keeping frictionCoefficient strictly positive), fall through to null.
  let walkableSlopeDeg = null;
  if (Number.isFinite(criticalSlipDeg) && Number.isFinite(tippingSlipDeg)) {
    walkableSlopeDeg = Math.min(criticalSlipDeg, tippingSlipDeg);
  } else if (Number.isFinite(criticalSlipDeg)) {
    walkableSlopeDeg = criticalSlipDeg;
  } else if (Number.isFinite(tippingSlipDeg)) {
    walkableSlopeDeg = tippingSlipDeg;
  }

  // --- No-slope report --------------------------------------------------------
  if (!slopeSupplied) {
    return {
      status: "ok",
      reason: undefined,
      slopeDeg: null,
      criticalSlipDeg,
      tippingSlipDeg,
      walkableSlopeDeg,
      slipOk: null,
      tipOk: null,
      requiredZmpShiftM: null,
      slopeMarginDeg: null,
      comHeight,
      footLengthM,
      footWidthM,
      frictionCoefficient,
    };
  }

  // --- With slope: evaluate slip / tip at the given slope ---------------------
  const slopeRad = slopeDeg * DEG_TO_RAD;

  // Slip: |tan θ| ≤ μ. We compare using absolute slope so a downhill walking
  // problem uses the same friction budget as an uphill one of equal magnitude.
  const slipOk = Math.abs(Math.tan(slopeRad)) <= frictionCoefficient;

  // Tip: only meaningful when a tipping solution exists.
  const tipOk = tippingSlipDeg == null
    ? true
    : Math.abs(slopeDeg) <= tippingSlipDeg;

  // Required ZMP shift: how far forward of the ankle the ZMP must move so
  // the down-slope gravity component balances against the foot's projected
  // length. Equals zero when the requested offset already sits on the toe
  // (or beyond — caller asked for the impossible). Numeric only.
  const footHalfM = C;                       // footLengthM / 2
  const requiredZmpShiftM =
    comOffsetFromAnkleM - footHalfM * Math.cos(slopeRad) + comHeight * Math.sin(slopeRad);

  // slopeMarginDeg = min(known limits) − |slope|, only when both limits known.
  let slopeMarginDeg = null;
  if (Number.isFinite(criticalSlipDeg) && Number.isFinite(tippingSlipDeg)) {
    slopeMarginDeg = Math.min(criticalSlipDeg, tippingSlipDeg) - Math.abs(slopeDeg);
  }

  let status = "ok";
  const reasons = [];
  if (!slipOk) reasons.push(`slip limit exceeded: |tan(θ)|=${Math.abs(Math.tan(slopeRad)).toFixed(4)} > μ=${frictionCoefficient} (slip limit ${criticalSlipDeg.toFixed(3)}°)`);
  if (!tipOk) reasons.push(`tip limit exceeded: |θ|=${Math.abs(slopeDeg).toFixed(3)}° > tipping limit ${tippingSlipDeg.toFixed(3)}°`);
  if (reasons.length) status = "fail";

  if (tippingNote) reasons.push(tippingNote);

  return {
    status,
    reason: reasons.length ? reasons.join("; ") : undefined,
    slopeDeg,
    criticalSlipDeg,
    tippingSlipDeg,
    walkableSlopeDeg,
    slipOk,
    tipOk,
    requiredZmpShiftM,
    slopeMarginDeg,
    comHeight,
    footLengthM,
    footWidthM,
    frictionCoefficient,
  };
}

function notComputed(field) {
  return {
    status: "not_computed",
    reason: `not_computed — missing required input: ${field}`,
    slopeDeg: null,
    criticalSlipDeg: null,
    tippingSlipDeg: null,
    walkableSlopeDeg: null,
    slipOk: null,
    tipOk: null,
    requiredZmpShiftM: null,
    slopeMarginDeg: null,
    comHeight: undefined,
    footLengthM: undefined,
    footWidthM: undefined,
    frictionCoefficient: undefined,
  };
}

function notComputedWithLimits(field, comHeight, footLengthM, footWidthM, frictionCoefficient, slopeDeg) {
  // Caller asked for a slope-specific evaluation but is missing a required
  // input. Return the not_computed envelope and also echo back the inputs we
  // did receive, mirroring the shape of the success case.
  return {
    status: "not_computed",
    reason: `not_computed — missing required input: ${field}`,
    slopeDeg,
    criticalSlipDeg: null,
    tippingSlipDeg: null,
    walkableSlopeDeg: null,
    slipOk: null,
    tipOk: null,
    requiredZmpShiftM: null,
    slopeMarginDeg: null,
    comHeight,
    footLengthM,
    footWidthM,
    frictionCoefficient,
  };
}

registerSolver({
  id: "gait.slope-walking",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "gait.slope-limits",
  fidelity: 1,
    // Graph-native: runs when any node carries props.gait.slope.
  // The props subtree is passed straight through to slopeWalking.
  targets: graphTargets("gait.slope"),
  run: graphRunner("gait.slope", (ctx, id, props) => envelope(slopeWalking(props))),});
