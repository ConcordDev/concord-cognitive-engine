// server/lib/conkay/aero/shape.js
//
// Roadmap 5 item 5. The tail face is smaller than Kamm's 50 percent so the
// v1 base-drag term falls. The roof, the nose, the fastback limit and the
// doors are not moved, and the styling image is not a source of dimensions.
//
// From drag-buildup.js, with the forebody term held fixed:
//   Cd_base = K * (Ab / A)^(3/2) / sqrt(Cd_fore)
// so a smaller base area lowers that term. The slant term stays 0 only while
// the measured rear slant is at or below Ahmed's onset (12.5 deg). Above
// 12.5 deg the high bound adds up to 0.14 and the cut is not a reduction.
// v1 has no lift coefficient. The 2D panel method reports a sign only when
// both Kutta corners agree. Calibrated drag v2 is not used.

import { BUILDUP_COEFFICIENTS } from "./drag-buildup.js";
import { CAD_BODY_DEFAULTS } from "../cad/body-params.js";

export const AERO_SHAPE_VERSION = "1.0.0";

/** Hoerner base term on the frontal area. fore is Cd_forebody, already on A. */
export function hoernerBase(fore, frontalA, baseA, K) {
  if (!(baseA > 0) || !(fore > 0) || !(frontalA > 0)) return 0;
  const foreB = (fore * frontalA) / baseA;
  return (K / Math.sqrt(foreB)) * (baseA / frontalA);
}

/**
 * The kamm-0.5 solid this change starts from.
 * Cache ~/.cache/conkay-cad-body/b1d9ec5642008c8708fe9d79 (height 1.282024 m).
 * Cd is dragBuildup at ISA sea level and 80.4672 m/s (180 mph), the same
 * centre the v1 solver reported for that solid: 0.19006044550065382.
 */
export const KAMM50_BASELINE = Object.freeze({
  kammAreaRatio: 0.5,
  cacheHash: "b1d9ec5642008c8708fe9d79",
  rearSlantDeg: 11.028599591315565,
  baseAreaM2: 0.9389644634644859,
  frontalAreaM2: 2.052268,
  wettedAreaM2: 26.289963,
  lengthM: 4.4900001510977745,
  heightM: 1.282024,
  cd: Object.freeze({ low: 0.10688989319367209, centre: 0.19006044550065382, high: 0.3379456360617403 }),
  baseTerm: Object.freeze({ low: 0.04909507807619394, high: 0.12908498649977895 }),
  slantTerm: Object.freeze({ low: 0, high: 0 }),
  sectionLift: Object.freeze({
    sign: "indeterminate",
    kuttaUpperCl2d: -17.98534118350615,
    kuttaLowerCl2d: 1.9969331610115466,
    note: "2D centreline section. The two Kutta corners disagree, so v1 reports no sign. Not a 3D lift coefficient.",
  }),
});

export const AHMED_ONSET_DEG = BUILDUP_COEFFICIENTS.slant.onsetDeg;

export const NOT_COPIED = Object.freeze([
  "The styling image is a two-door coupe with a long hood and large wheels. No dimension was read from it.",
  `Nose extension stays ${CAD_BODY_DEFAULTS.noseExtensionM} m.`,
  `Fastback limit stays ${CAD_BODY_DEFAULTS.fastbackDeg} deg. It is not steepened into the ${AHMED_ONSET_DEG}..${BUILDUP_COEFFICIENTS.slant.maxDeg} deg band.`,
  `Belt line stays ${CAD_BODY_DEFAULTS.beltMaxM} m. The roof was not lowered.`,
  "Four door apertures and the B-pillar stay.",
  "The tyre stays the library 245/40ZR18.",
]);

/**
 * Did this solid's v1 drag fall for the reason the build-up allows?
 * measured: { rearSlantDeg, baseAreaM2, cd:{low,centre,high}, terms:{low:{base,slant}, high:{base,slant}}, sectionLiftSign }
 */
export function shapeVerdict(measured, baseline = KAMM50_BASELINE) {
  const slantOk = measured.rearSlantDeg <= AHMED_ONSET_DEG;
  const slantTermClear = measured.terms.low.slant === 0 && measured.terms.high.slant === 0;
  const baseSmaller = measured.baseAreaM2 < baseline.baseAreaM2;
  const baseTermLower = measured.terms.low.base < baseline.baseTerm.low && measured.terms.high.base < baseline.baseTerm.high;
  const lowLower = measured.cd.low < baseline.cd.low;
  const highLower = measured.cd.high < baseline.cd.high;
  const centreLower = measured.cd.centre < baseline.cd.centre;
  const supported = slantOk && slantTermClear && baseSmaller && baseTermLower && lowLower && highLower && centreLower;
  return {
    supported,
    slantOk,
    slantTermClear,
    baseSmaller,
    baseTermLower,
    lowLower,
    highLower,
    centreLower,
    sectionLiftSign: measured.sectionLiftSign,
    liftDetermined: measured.sectionLiftSign === "lift" || measured.sectionLiftSign === "downforce",
    kammAreaRatio: CAD_BODY_DEFAULTS.kammAreaRatio,
    ahmedOnsetDeg: AHMED_ONSET_DEG,
  };
}
