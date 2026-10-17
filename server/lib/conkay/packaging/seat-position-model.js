// server/lib/conkay/packaging/seat-position-model.js
//
// Where drivers sit, as a distribution (Flannagan, Manary, Schneider and Reed 1998, SAE 980651: the Seating
// Accommodation Model, SAM). references.json samSeatPosition holds the equations and their locators.
//
// The layout places the front seat at the UMTRI-predicted H-point of the 95th-percentile male (a point on the
// mean-position equation, umtriHPointX in checks.js). SAM adds the scatter about that mean, so that position can
// be stated as a percentile of a driver population and an accommodation target can be stated as a design choice.
// Only OFFSETS between positions come from SAM here: its absolute mean (Eq. 8) needs the seat cushion angle and
// the transmission, which the layout does not set, while the stature slope (0.433) is shared with the UMTRI
// equation the layout uses for the absolute position. Deterministic; nothing here changes a layout.

import { PACKAGING_REFERENCES as REFS } from "./occupant.js";

const SAM = REFS.samSeatPosition;
const SLOPE = SAM.coefficients.statureSlope;
const VAR_STATURE = SAM.coefficients.statureSlopeSquared;
const VAR_RESIDUAL = SAM.coefficients.residualVariance;

/** Standard normal CDF (Abramowitz and Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return 0.5 * (1 + (z >= 0 ? y : -y));
}

/** Eq. 9: the single-gender seat-position standard deviation (mm) for a stature standard deviation (mm). */
export const samSeatPositionSd = (statureSdMm) => Math.sqrt(VAR_STATURE * statureSdMm ** 2 + VAR_RESIDUAL);

/**
 * The two single-gender seat-position distributions of a driver population, in mm relative to the mean male
 * position (the male mean = 0; the female mean follows from the stature slope: Eq. 8 differs only through muS).
 * population: { maleMeanMm, maleSdMm, femaleMeanMm, femaleSdMm }; defaults to Table 4's US population.
 */
export function samDistributions(population = SAM.populations.US) {
  return {
    male: { meanMm: 0, sdMm: samSeatPositionSd(population.maleSdMm) },
    female: { meanMm: SLOPE * (population.femaleMeanMm - population.maleMeanMm), sdMm: samSeatPositionSd(population.femaleSdMm) },
  };
}

/** The mixture CDF (Eq. 13) at x (mm relative to the male mean), k the proportion of males. */
export function samMixtureCdf(x, { k = 0.5, population } = {}) {
  const d = samDistributions(population);
  return k * normalCdf((x - d.male.meanMm) / d.male.sdMm) + (1 - k) * normalCdf((x - d.female.meanMm) / d.female.sdMm);
}

/** The seat position (mm relative to the male mean) at population percentile p (0..1): Eq. 13 solved by bisection. */
export function samPercentileOffsetMm(p, { k = 0.5, population } = {}) {
  let lo = -1000, hi = 1000;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (samMixtureCdf(m, { k, population }) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * An accommodation target as a seat track: the central `fraction` of the population (e.g. 0.95: the 2.5th to
 * 97.5th percentile of seat position) sits inside the track. Returns offsets from the male mean (mm) and the track
 * length. The target itself is a DESIGN CHOICE; SAM supplies the positions.
 */
export function samAccommodationTrack(fraction, opts = {}) {
  const lo = samPercentileOffsetMm((1 - fraction) / 2, opts), hi = samPercentileOffsetMm(1 - (1 - fraction) / 2, opts);
  return { fraction, frontOffsetMm: lo, rearOffsetMm: hi, lengthMm: hi - lo };
}

/**
 * The share of the population whose preferred seat position is at or ahead of `offsetMm` (mm aft of the male mean
 * position, in the same frame as samPercentileOffsetMm), and the share a track [front, rear] accommodates.
 */
export const samPercentileOfOffset = (offsetMm, opts = {}) => samMixtureCdf(offsetMm, opts);
export const samTrackCoverage = (frontOffsetMm, rearOffsetMm, opts = {}) => samMixtureCdf(rearOffsetMm, opts) - samMixtureCdf(frontOffsetMm, opts);

/**
 * Where a layout's front seat sits in the driver population. hxAtStature(S mm) -> the layout's H-point x (m) for
 * stature S (the UMTRI mean equation); seatX the front seat H-point the rear is derived against (m); trackRearX /
 * trackFrontX the seat track's ends (m). Reference: the US male mean stature (Table 4). Info only.
 */
export function frontSeatPopulationPosition({ hxAtStature, seatX, trackFrontX, trackRearX, population = SAM.populations.US }) {
  const ref = hxAtStature(population.maleMeanMm);
  const off = (x) => (x - ref) * 1000;
  const r1 = (v) => Math.round(v * 10) / 10, r3 = (v) => Math.round(v * 1e3) / 1e3;
  return {
    basis: "SAM (SAE 980651) scatter about the UMTRI-predicted mean position; 1:1 male:female, US stature distribution (Table 4); offsets from the mean male position",
    seatOffsetMm: r1(off(seatX)),
    seatPopulationPercentile: r3(samPercentileOfOffset(off(seatX))),
    ...(trackFrontX != null && trackRearX != null ? {
      trackOffsetsMm: [r1(off(trackFrontX)), r1(off(trackRearX))],
      trackLengthMm: r1((trackRearX - trackFrontX) * 1000),
      trackCoverage: r3(samTrackCoverage(off(trackFrontX), off(trackRearX))),
      trackRearPercentile: r3(samPercentileOfOffset(off(trackRearX))),
    } : {}),
    rearOffsetsMm: Object.fromEntries([0.9, 0.95, 0.99].map((f) => [`central${Math.round(f * 100)}`, r1(samAccommodationTrack(f).rearOffsetMm)])),
  };
}
