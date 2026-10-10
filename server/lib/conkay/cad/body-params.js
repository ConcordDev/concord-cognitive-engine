// server/lib/conkay/cad/body-params.js
//
// Parameters of the CAD body (cad.body, conkay_body_occ.py). Every value is a
// DESIGN CHOICE with its basis; they live on the BODY_SHELL node's geometry
// in the design graph, so an edit (session.edit) re-solves the body.

import { getMaterial } from "../materials/index.js";

export const CAD_BODY_MATERIAL = "cfrp-hexply-8552-agp193pw";

export const CAD_BODY_DEFAULTS = Object.freeze({
  plies: 15,
  skinOffsetM: 0.04,
  stationCount: 56,
  sectionPoints: 40,
  upperExponent: 3.0,
  lowerExponent: 8.0,
  beltMinM: 0.62,
  beltMaxM: 0.85,
  beltSigmaM: 0.3,
  profileSigmaM: 0.12,
  lowerOverlapM: 0.03,
  fastbackDeg: 18,
  floorRiseDeg: 8,
  floorCornerAllowanceM: 0.015,
  planClosingRadiusM: 3.0,
  roofClosingRadiusM: 4.0,
  floorClosingRadiusM: 3.0,
  noseExtensionM: 0.3,
  noseTipHeightM: 0.25,
  noseShapeExponent: 1.6,
  noseRoundExponent: 3.0,
  tailExtensionM: 0.22,
  kammAreaRatio: 0.45,
  archClearanceM: 0.04,
  fenderSkinM: 0.03,
  fenderCoverM: 0.02,
  podExponent: 6.0,
  podBlendM: 0.45,
  podMinHalfWidthM: 0.3,
  podTuckM: 0.1,
  blendRadiusM: 0.08,
  inletAllowanceM: 0.06,
  fairSigmaXM: 0.25,
  fairSigmaXSideM: 0.45,
  fairSigmaTheta: 0.1,
  fairHoodCloseRadiusM: 6.0,
  fairPoleSpacingM: 0.24,
  maxWidthM: 1.95,
});

export const CAD_BODY_BASIS = Object.freeze({
  plies: "design choice: skin laminate of 15 plies of HexPly 8552/AGP193-PW at the published 0.195 mm cured ply thickness = 2.925 mm (closest to the earlier 3 mm skin; no panel stiffness or crash analysis behind it)",
  skinOffset: "design choice (25-50 mm band): minimum distance from every enclosed envelope to the outer surface, for skin, structure and trim",
  stationCount: "design choice: cross-sections along the envelopes (plus 4 nose and 3 tail sections)",
  sectionPoints: "design choice: rays per half section on which the section curve is sampled (same angles on every section)",
  upperExponent: "design choice: exponent of the greenhouse half-superellipse (2 = ellipse, larger = boxier); sets the tumblehome",
  lowerExponent: "design choice: superellipse exponent of the lower body (8: near-vertical sides and a flat floor)",
  beltMin: "design choice: lowest belt line (top of the lower body / base of the greenhouse)",
  beltMax: "design choice: highest belt line; below it everything is greenhouse (narrower, with tumblehome)",
  beltSigma: "design choice: Gaussian smoothing length of the belt line along the car",
  profileSigma: "design choice: Gaussian smoothing length of the floor, roof and plan-width lines (applied as a smooth envelope that still holds every point)",
  lowerOverlap: "design choice: how far the lower body reaches above the belt line into the greenhouse (no seam at the belt)",
  floorRiseDeg: "design choice: steepest rise of the floor line toward the nose and tail (an underbody ramp, not a tuned diffuser)",
  fastbackDeg: "design choice: steepest descent of the roof line behind its last requirement (the fastback slope)",
  floorCornerAllowance: "design choice: how far the floor may sit below the lowest enclosed point (the rounded lower corners need some); stops the solve trading floor height for width",
  planClosingRadius: "design choice: rolling-disc radius smoothing the plan-view widths (no waist pinches tighter than this)",
  roofClosingRadius: "design choice: rolling-disc radius smoothing the roof line; with fastbackDeg sets the windscreen and backlight",
  floorClosingRadius: "design choice: rolling-disc radius smoothing the floor",
  noseExtension: "design choice: nose length ahead of the frontmost envelope (the radiator's air-inlet allowance)",
  noseTipHeight: "design choice: height of the nose tip above the ground",
  noseShapeExponent: "design choice: exponent of the nose taper (below 2 is sharper than an ellipse)",
  noseRoundExponent: "design choice: superellipse exponent of the rounded section the nose blends into toward its tip (the fender pods fade out)",
  tailExtension: "design choice: tail length behind the rearmost envelope, tapered to the Kamm truncation",
  kammAreaRatio: "design choice 0.45, checked by the v1 drag build-up. Kamm's truncation is 50 percent of the largest section (Wikipedia 'Kammback', citing Kamm / Koenig-Fachsenfeld); 0.45 is not that figure. Hoerner's base term (Saltzman, Wang and Iliff, AIAA 99-0383, eq. 14) falls as the tail face shrinks. The face is kept only while the measured rear slant stays at or below Ahmed's 12.5 deg onset (SAE 840300), so the slant term stays 0. Not taken from the styling image. The build-up has no 3D lift coefficient.",
  archClearance: "design choice: wheel-well radius beyond the tyre's swept radius (sqrt(r^2 + w^2/2^2) for steered wheels); suspension travel is not published, so jounce is not in it",
  fenderSkin: "design choice: body material kept over the top of each wheel well (the fender crown)",
  fenderCover: "design choice: fender side beyond the tyre's outer face over the wheel (static, straight ahead)",
  podExponent: "design choice: superellipse exponent of the fender pods (6: flat crown, rounded shoulders)",
  podBlend: "design choice: length over which each fender pod fades into the body side fore and aft of its wheel well",
  podMinHalfWidth: "design choice: smallest half width of a fender pod",
  podTuck: "design choice: how far the fender pod's side tucks in at the floor (a quarter circle from the wheel centre height down)",
  blendRadius: "design choice: smooth-maximum radius blending the pods, lower body and greenhouse",
  inletAllowance: "design choice: depth of an air-inlet / duct allowance ahead of the radiator face, enclosed like a component",
  fairSigmaX: "design choice: fairing length along the car (Gaussian sigma) of the section radius field; the faired field never goes inside the solved sections (so every envelope keeps its skin offset at the stations), never below the floor and never wider than maxWidth",
  fairSigmaTheta: "design choice: fairing angle around each section (Gaussian sigma, radians); fills the concave creases between the fender pods, the lower body and the greenhouse with a fillet of roughly this angle",
  fairSigmaXSide: "design choice (kernel 2.2): fairing length along the car on the side-facing rays (the door and flanks; the roof, hood and floor keep fairSigmaX, so the roof line does not lift); removed the 2.1 door bump (a 28-43 mm dip in the side behind the front occupants' shoulders)",
  fairHoodCloseRadius: "design choice (kernel 2.2): rolling-disc radius closing the top outline of each front-pod station (weighted by the pod's blend) before the fairing; fills the valley where the hood dome meets the fender pods (the 2.1 S-bend). Outward only: every envelope keeps its skin offset",
  fairPoleSpacing: "design choice: control-point spacing of the surface along the car (a least-squares cubic B-spline, about one control point per this length, instead of interpolating every section); larger is smoother and follows the sections less closely, so the exact clearance pass re-checks the result",
  maxWidth: "design choice (requirement-like bound, from the brief's sports 2+2 band): overall body width; the fairing's width cap is tightened until the lofted body is within it, never below what the tyres and envelopes need (then the solver fails)",
});

const mm = (m) => `${Math.round(m * 1e6) / 1e3} mm`;

/** The BODY_SHELL geometry (design-graph form, with units) for these parameters. */
const LENGTHS = ["noseExtension", "noseTipHeight", "tailExtension", "archClearance", "fenderSkin", "fenderCover", "floorCornerAllowance", "beltMin", "beltMax", "beltSigma", "profileSigma", "lowerOverlap", "podBlend", "podMinHalfWidth", "podTuck", "blendRadius", "inletAllowance", "planClosingRadius", "roofClosingRadius", "floorClosingRadius", "fairSigmaX", "fairSigmaXSide", "fairHoodCloseRadius", "fairPoleSpacing", "maxWidth"];
const NUMBERS = ["stationCount", "sectionPoints", "upperExponent", "lowerExponent", "fastbackDeg", "floorRiseDeg", "noseShapeExponent", "noseRoundExponent", "kammAreaRatio", "podExponent", "fairSigmaTheta"];

/** The BODY_SHELL geometry (design-graph form, with units) for these parameters. */
export function cadBodyGeometry(bp) {
  const ply = getMaterial(CAD_BODY_MATERIAL)?.plyThicknessM;
  return {
    shape: "cad-body",
    thickness: mm(bp.plies * ply),
    skinOffset: mm(bp.skinOffsetM),
    ...Object.fromEntries(LENGTHS.map((k) => [k, mm(bp[`${k}M`])])),
    ...Object.fromEntries(NUMBERS.map((k) => [k, bp[k]])),
  };
}

// Geometry keys of a cad-body beyond the required thickness and skinOffset.
export const CAD_BODY_OPTIONAL = Object.freeze({ lengths: LENGTHS, numbers: NUMBERS });
