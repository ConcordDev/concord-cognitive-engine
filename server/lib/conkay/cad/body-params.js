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
  stationCount: 44,
  sectionPoints: 20,
  upperExponent: 2.4,
  lowerExponent: 8.0,
  beltSmoothing: 8,
  floorCornerAllowanceM: 0.015,
  planClosingRadiusM: 8.0,
  roofClosingRadiusM: 2.5,
  floorClosingRadiusM: 40.0,
  noseExtensionM: 0.16,
  tailExtensionM: 0.1,
  archClearanceM: 0.04,
  fenderSkinM: 0.03,
  fenderCoverM: 0.02,
});

export const CAD_BODY_BASIS = Object.freeze({
  plies: "design choice: skin laminate of 15 plies of HexPly 8552/AGP193-PW at the published 0.195 mm cured ply thickness = 2.925 mm (closest to the earlier 3 mm skin; no panel stiffness or crash analysis behind it)",
  skinOffset: "design choice (25-50 mm band): minimum distance from every enclosed envelope to the outer surface, for skin, structure and trim",
  stationCount: "design choice: cross-sections along the envelopes (plus 3 nose and 3 tail sections)",
  sectionPoints: "design choice: points per quarter section interpolated by the B-spline",
  upperExponent: "design choice: superellipse exponent above the belt line (2 = ellipse, larger = boxier); sets the tumblehome",
  lowerExponent: "design choice: superellipse exponent below the belt line (8: near-vertical sides and a flat floor)",
  beltSmoothing: "design choice: belt line = moving average of the per-section optimum over this many sections each side",
  floorCornerAllowance: "design choice: how far the floor may sit below the lowest enclosed point (the rounded lower corners need some); stops the solve trading floor height for width",
  planClosingRadius: "design choice: rolling-disc radius smoothing the plan-view half width (no waist pinches tighter than this)",
  roofClosingRadius: "design choice: rolling-disc radius smoothing the roof line; sets the windscreen and backlight slopes",
  floorClosingRadius: "design choice: rolling-disc radius smoothing the floor (large = flat floor)",
  noseExtension: "design choice: nose length ahead of the frontmost envelope (quarter-ellipse taper)",
  tailExtension: "design choice: tail length behind the rearmost envelope (quarter-ellipse taper)",
  archClearance: "design choice: wheel-well radius beyond the tyre's swept radius (sqrt(r^2 + w^2/2^2) for steered wheels); suspension travel is not published, so jounce is not in it",
  fenderSkin: "design choice: body material kept over the top of each wheel well",
  fenderCover: "design choice: body side beyond the tyre's outer face over the wheel (static, straight ahead)",
});

const mm = (m) => `${Math.round(m * 1e6) / 1e3} mm`;

/** The BODY_SHELL geometry (design-graph form, with units) for these parameters. */
export function cadBodyGeometry(bp) {
  const ply = getMaterial(CAD_BODY_MATERIAL)?.plyThicknessM;
  return {
    shape: "cad-body",
    thickness: mm(bp.plies * ply),
    skinOffset: mm(bp.skinOffsetM),
    noseExtension: mm(bp.noseExtensionM),
    tailExtension: mm(bp.tailExtensionM),
    archClearance: mm(bp.archClearanceM),
    fenderSkin: mm(bp.fenderSkinM),
    fenderCover: mm(bp.fenderCoverM),
    floorCornerAllowance: mm(bp.floorCornerAllowanceM),
    planClosingRadius: `${bp.planClosingRadiusM} m`,
    roofClosingRadius: `${bp.roofClosingRadiusM} m`,
    floorClosingRadius: `${bp.floorClosingRadiusM} m`,
    stationCount: bp.stationCount,
    sectionPoints: bp.sectionPoints,
    upperExponent: bp.upperExponent,
    lowerExponent: bp.lowerExponent,
    beltSmoothing: bp.beltSmoothing,
  };
}

// Geometry keys of a cad-body beyond the required thickness and skinOffset.
export const CAD_BODY_OPTIONAL = Object.freeze({
  lengths: ["noseExtension", "tailExtension", "archClearance", "fenderSkin", "fenderCover", "floorCornerAllowance", "planClosingRadius", "roofClosingRadius", "floorClosingRadius"],
  numbers: ["stationCount", "sectionPoints", "upperExponent", "lowerExponent", "beltSmoothing"],
});
