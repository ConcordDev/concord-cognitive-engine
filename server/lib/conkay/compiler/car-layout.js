// server/lib/conkay/compiler/car-layout.js
//
// The car's package layout: where every library component with published
// (or estimated) dimensions sits, and the seating design (accelerator heel
// point, seat height, torso angle, seat track, steering wheel). Each number
// here is a DESIGN CHOICE (labelled, with its reason) or comes from a
// library entry's dimensions (sourced or estimated, with its source). The
// layout replaces the placeholder centroids the car was built with, so mass
// properties and packaging use the same positions. The checks themselves
// are in packaging/checks.js (solvers package.occupant-fit and
// package.interference).
//
// Front-engine, rear-drive: radiator, engine behind it with the front axle
// through the engine bay, bellhousing and TREMEC TKX behind the engine,
// front seats behind the footwell, rear seats ahead of the Super 8.8 IRS at
// the rear axle, fuel cell above and behind the differential.

import { seatBoxes, umtriHPointX } from "../packaging/checks.js";
import { seatOccupant, occupantDims, PACKAGING_REFERENCES } from "../packaging/occupant.js";
import { aabb, separation } from "../packaging/geometry.js";

const IN = 0.0254;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

/** Seating and layout design choices (metres, degrees), each with its basis. */
export const LAYOUT_DESIGN_CHOICES = Object.freeze({
  floorZ: { value: 0.12, basis: "design choice: cabin floor (heel rest surface) height above ground" },
  engineBottomZ: { value: 0.15, basis: "design choice: lowest point of the engine envelope above ground" },
  radiatorFrontX: { value: 0.5, basis: "design choice: radiator front face, inside the nose" },
  radiatorCenterZ: { value: 0.45, basis: "design choice" },
  fanGapM: { value: 0.08, basis: "design choice: space between radiator and engine for the fan and shroud (their depth is not in the library)" },
  firewallGapM: { value: 0.05, basis: "design choice: engine envelope to footwell front wall" },
  ahpX: { value: 1.8, basis: "design choice: accelerator heel point (AHP), behind the footwell front wall" },
  footAngleDeg: { value: 40, basis: "design choice: heel-to-ball-of-foot line on the accelerator, above horizontal (no pedal box selected)" },
  h30: { value: 0.22, basis: "design choice: SAE J1100 H30 (H-point above AHP), within the J1100 Class A range 127-405 mm" },
  torsoDeg: { value: 25, basis: "design choice: SAE J1100 L40 torso angle, within the Class A range 5-40 deg" },
  frontSeatY: { value: 0.37, basis: "design choice: SAE J1100 W20, seat centreline from the car centreline" },
  seatTrackTravel: { value: 0.24, basis: "design choice: seat track travel, above the J1100 Class A minimum of 100 mm, centred on the UMTRI-predicted H-point of the 50th percentile male" },
  steeringWheelDiameter: { value: 0.35, basis: "design choice: below the J1100 Class A maximum W9 of 450 mm" },
  steeringWheelL6: { value: 0.55, basis: "design choice: PRP to steering wheel centre, fore-aft (UMTRI W, J4004 L6)" },
  steeringWheelH17: { value: 0.64, basis: "design choice: SAE J1100 H17, AHP to steering wheel centre, vertical" },
  steeringWheelTiltDeg: { value: 25, basis: "design choice: wheel plane from vertical, top toward the driver" },
  steeringWheelDepth: { value: 0.06, basis: "design choice: rim and hub depth of the wheel envelope" },
  rearSgRPX: { value: 3.38, basis: "design choice: rear H-point between the front seat backs and the rear axle (moving it forward costs rear knee room, rearward runs into the differential)" },
  rearH31: { value: 0.2, basis: "design choice: SAE J1100 H31 (rear H-point above the rear heel point)" },
  rearSeatY: { value: 0.33, basis: "design choice: rear seat centreline from the car centreline" },
  rearTorsoDeg: { value: 25, basis: "design choice: rear torso angle" },
  fuelCellCenter: { value: [3.99, 0, 0.685], basis: "design choice: fuel cell above and behind the differential, behind the rear seat backs" },
  diffRiseM: { value: 0, basis: "design choice: differential centre above the rear axle line (0: centred on the axle)" },
});

/** Inner front-wheel lock (deg) from the reference S550 turning circle (estimated; see references.json steeringLock). */
export function steeringLockDeg(ref) {
  const wb = ref.inches.wheelbase, tr = ref.inches.frontTrack, R = (ref.feet.turningDiameterCurbToCurb * 12) / 2;
  const outer = Math.asin(wb / R);
  const inner = Math.atan(wb / (wb / Math.tan(outer) - tr));
  return { innerDeg: (inner * 180) / Math.PI, outerDeg: (outer * 180) / Math.PI };
}

/**
 * Place the components. entries: { engine, gearbox, diff, cooling, fuel, tyre, seatFront } library
 * entries (any may be null). frontAxleX, rearAxleX and track are the design's.
 * Returns { positions: { nodeId: {x,y,z} }, components: [...], designChoices, firewallX, notChecked }.
 */
export function layoutCar({ entries, frontAxleX, rearAxleX, track, choices = LAYOUT_DESIGN_CHOICES }) {
  const c = Object.fromEntries(Object.entries(choices).map(([k, v]) => [k, v.value]));
  const comps = [];
  const positions = {};
  const place = (node, entry, half, center, dims, placement, extra = {}) => {
    positions[node] = { x: r4(center[0]), y: r4(center[1]), z: r4(center[2]) };
    comps.push({ id: node, node, component: entry?.id || null, half: half.map(r4), pitchDeg: 0, dims, placement, ...extra });
  };
  const dimSrc = (e) => ({ state: e.dimensions.state, ...(e.dimensions.method ? { method: e.dimensions.method } : {}), source: e.dimensions.source?.url || null });
  // Radiator.
  let x = c.radiatorFrontX;
  const rad = entries.cooling;
  if (rad?.dimensions?.overallThicknessIn) {
    const t = rad.dimensions.overallThicknessIn * IN, w = rad.dimensions.overallWidthIn * IN, h = rad.dimensions.overallHeightIn * IN;
    place("RADIATOR", rad, [t / 2, w / 2, h / 2], [x + t / 2, 0, c.radiatorCenterZ], { thicknessM: r4(t), widthM: r4(w), heightM: r4(h), ...dimSrc(rad) }, "radiator front face at radiatorFrontX (design choice)");
    x += t + c.fanGapM;
  }
  // Engine: crank axis assumed at the envelope's mid-height (no crank height published).
  const eng = entries.engine;
  let engineRear = null, crankZ = null;
  if (eng?.dimensions?.lengthM) {
    const { lengthM: L, widthM: W, heightM: H } = eng.dimensions;
    crankZ = c.engineBottomZ + H / 2;
    place("ENGINE", eng, [L / 2, W / 2, H / 2], [x + L / 2, 0, crankZ], { lengthM: L, widthM: W, heightM: H, ...dimSrc(eng) }, "front face behind the radiator and fan gap; bottom at engineBottomZ (design choices)");
    engineRear = x + L;
  }
  const firewallX = engineRear != null ? engineRear + c.firewallGapM : null;
  // Transmission: the bellhousing depth taken as the TKX input shaft length (estimated); the case from the
  // transmission face is overall length minus input shaft; cross-section = the face (largest section, sourced).
  const gb = entries.gearbox;
  const notChecked = [];
  if (gb?.dimensions?.overallLengthM && engineRear != null) {
    const d = gb.dimensions;
    const face = engineRear + d.inputShaftLengthM;
    const caseL = d.overallLengthM - d.inputShaftLengthM;
    place("TRANSMISSION", gb, [caseL / 2, d.faceWidthM / 2, d.faceHeightM / 2], [face + caseL / 2, 0, crankZ],
      { caseLengthM: r4(caseL), faceWidthM: d.faceWidthM, faceHeightM: d.faceHeightM, ...dimSrc(gb), lengthMethod: "estimated: case length = published overall length minus the input shaft length (the shaft sits in the bellhousing); cross-section = the published transmission face (the case behind it is smaller)" },
      "on the crank axis; face one input-shaft length behind the engine (estimated bellhousing depth)");
    notChecked.push({ item: "bellhousing", reason: "no bellhousing dimensions in the library (its depth is taken as the TKX input shaft length)" });
  }
  // Differential at the rear axle, axle height = tyre radius.
  const tyreR = entries.tyre?.dimensions?.overallDiameterM ? entries.tyre.dimensions.overallDiameterM / 2 : null;
  const df = entries.diff;
  if (df?.dimensions?.lengthM && tyreR) {
    const d = df.dimensions;
    const rise = c.diffRiseM || 0;
    place("DIFFERENTIAL", df, [d.lengthM / 2, d.widthM / 2, d.heightM / 2], [rearAxleX, 0, tyreR + rise], { lengthM: d.lengthM, widthM: d.widthM, heightM: d.heightM, ...dimSrc(df) }, rise ? `on the rear axle x, centre ${r4(rise * 1000)} mm above axle height (diffRiseM, design choice)` : "centred on the rear axle at axle height (tyre radius)");
  }
  // Fuel cell: the internal container the cell fits (published), 450 fore-aft, 630 across, 250 high (orientation design choice).
  const fu = entries.fuel;
  if (fu?.dimensions?.fitsInternalContainerMm) {
    const [a, b, h] = fu.dimensions.fitsInternalContainerMm.map((v) => v / 1000);
    place("FUEL_CELL", fu, [a / 2, b / 2, h / 2], c.fuelCellCenter, { containerM: [a, b, h], ...dimSrc(fu), orientation: "design choice: 450 mm fore-aft, 630 mm across, 250 mm high" }, "fuelCellCenter (design choice)");
  }
  // Tyres: bounding box of the cylinder; front ones with the steering sweep.
  const ty = entries.tyre;
  const tyres = [];
  if (ty?.dimensions?.overallDiameterM) {
    const D = ty.dimensions.overallDiameterM, w = ty.dimensions.sectionWidthM;
    for (const [p, ax] of [["FL", frontAxleX], ["FR", frontAxleX], ["RL", rearAxleX], ["RR", rearAxleX]]) {
      const y = (p.endsWith("L") ? -1 : 1) * (track / 2);
      positions[`TIRE_${p}`] = { x: ax, y, z: r4(D / 2) };
      positions[`WHEEL_${p}`] = { x: ax, y, z: r4(D / 2) };
      tyres.push({ id: `TIRE_${p}`, node: `TIRE_${p}`, component: ty.id, diameterM: D, widthM: w, steered: p.startsWith("F"), dims: { diameterM: D, sectionWidthM: w, ...dimSrc(ty) } });
    }
  }
  return {
    positions, components: comps, tyres, firewallX: firewallX != null ? r4(firewallX) : null, crankZ,
    designChoices: choices, notChecked,
  };
}

/**
 * Layout revision 2 (step 4, the CAD body): the #1039 failures resolved by
 * deriving the rear package from the occupant and component envelopes
 * instead of fixing it by hand. Each entry is a design choice (a margin) or
 * a derivation with its method; v1 values are kept for the old/new table.
 */
export const LAYOUT_REVISION_CHOICES = Object.freeze({
  rearKneeMarginM: { value: 0.025, basis: "design choice: rear knee clearance beyond the SAE J1100 L48 51 mm allowance (M95 every seat)" },
  diffClearanceM: { value: 0.025, basis: "design choice: rear occupant envelopes to the differential envelope (the differential box is the shipping-box upper bound)" },
  fuelClearanceM: { value: 0.025, basis: "design choice: fuel cell to the rear occupants and to the differential" },
  frontSeatBackThicknessM: { value: 0.06, basis: "design choice: front seatback thickness behind the occupant's back surface (RECARO publishes no backrest thickness); counted in the seat envelope and in L48" },
});

const mmUp = (v) => Math.ceil(v * 1000 - 1e-9) / 1000;

/** Smallest x in [lo, hi] with f(x) >= 0 for a non-decreasing f (bisection to 0.1 mm). */
function smallestX(f, lo, hi) {
  if (f(lo) >= 0) return lo;
  if (f(hi) < 0) return null;
  for (let i = 0; i < 60 && hi - lo > 1e-4; i++) { const m = (lo + hi) / 2; if (f(m) >= 0) hi = m; else lo = m; }
  return hi;
}

/**
 * Derive the rear package from the envelopes, every percentile in every seat:
 *   rearSgRPX  the smallest rear H-point x giving every occupant L48 >= the knee margin
 *              (front seat at the SgRP-front, J1100 L48 51 mm allowance);
 *   rearAxleX  the smallest rear axle x putting the differential envelope the clearance behind
 *              every rear occupant envelope (separating-axis gap);
 *   fuelCellCenter  above the differential (clearance), the smallest x clearing the rear occupants.
 * Returns { rearSgRPX, rearAxleX, fuelCellCenter, method } (m), or { error }.
 */
export function deriveRearPackage({ choices, keys, seatDims, diffDims, fuelDimsM, tyreR, rearWell = null }) {
  const c = Object.fromEntries(Object.entries(choices).map(([k, v]) => [k, v.value]));
  const J = PACKAGING_REFERENCES.saeJ1100.definitions;
  if (!seatDims || !diffDims || !tyreR) return { error: "needs the front seat dimensions, the differential dimensions and the tyre radius" };
  const fa = (c.footAngleDeg * Math.PI) / 180;
  const prpX = c.ahpX - (J.BOF.valueMm / 1000) * Math.cos(fa);
  const hx = (k) => prpX + umtriHPointX(occupantDims(k).stature, c.steeringWheelL6, c.h30);
  const trackRear = hx("M50") + c.seatTrackTravel / 2;
  const sgRPFrontX = Math.min(hx("M95"), trackRear);
  const hz = c.floorZ + c.h30;
  const seatRearX = seatBoxes("SgRP", seatDims, { x: sgRPFrontX, y: 0, z: hz }, c.torsoDeg, c.floorZ, c.frontSeatBackThicknessM || 0).rearX;
  const rearZ = c.floorZ + c.rearH31;
  const rearOccAt = (x, y, sides = [-1, 1]) => keys.flatMap((k) => sides.map((s) => seatOccupant(k, { id: s < 0 ? "SEAT_3" : "SEAT_4", hPoint: { x, y: s * y, z: rearZ }, torsoDeg: c.rearTorsoDeg, posture: "rear", floorZ: c.floorZ })));
  // Knee pivot relative to the H-point does not depend on the H-point's x.
  const kneeAhead = Math.max(...rearOccAt(0, c.rearSeatY).map((o) => -o.landmarks.knee[0]));
  const rearSgRPX = mmUp(seatRearX + J.L48.subtractMm / 1000 + c.rearKneeMarginM + kneeAhead);
  const d = diffDims;
  const dz = tyreR + (c.diffRiseM || 0);
  const diffAt = (x) => aabb({ id: "DIFFERENTIAL", min: [x - d.lengthM / 2, -d.widthM / 2, dz - d.heightM / 2], max: [x + d.lengthM / 2, d.widthM / 2, dz + d.heightM / 2] });
  const minSepTo = (boxes, b) => Math.min(...boxes.map((o) => separation(o, b).separation));
  const axleFor = (y) => {
    const boxes = rearOccAt(rearSgRPX, y).flatMap((o) => o.boxes);
    const ax = smallestX((x) => minSepTo(boxes, diffAt(x)) - c.diffClearanceM, rearSgRPX, rearSgRPX + 2);
    return ax == null ? null : mmUp(ax);
  };
  // The rear wheel well (the CAD body's cut: radius = tyre radius + arch clearance, inner wall at
  // track/2 - tyre half-width - arch clearance), bounded by a box (so the gap to it is a lower bound
  // on the gap to the cylinder): the rear seat centreline is the largest y (<= the design's
  // rearSeatY, rounded down to 1 mm) at which every rear occupant box is the body's skin offset
  // clear of it and the two rear occupants do not overlap. The axle depends on y and the well on the
  // axle, so the two are solved alternately to a fixed point.
  let rearSeatY = c.rearSeatY;
  let rearAxleX = axleFor(rearSeatY);
  if (rearAxleX == null) return { error: "no rear axle position within 2 m behind the rear H-point clears the rear occupants" };
  let wellNote = null;
  if (rearWell) {
    const { track, tyreHalfWidthM, archClearanceM, clearanceM } = rearWell;
    const R = tyreR + archClearanceM, yIn = track / 2 - tyreHalfWidthM - archClearanceM;
    for (let pass = 0; pass < 8; pass++) {
      const well = aabb({ id: "REAR_WELL", min: [rearAxleX - R, yIn, tyreR - R], max: [rearAxleX + R, yIn + 1, tyreR + R] });
      const side = (y, sg) => rearOccAt(rearSgRPX, y, [sg]).flatMap((o) => o.boxes);
      const wellGap = (y) => minSepTo([...side(y, -1), ...side(y, 1)], well) - clearanceM; // decreasing in y
      const apart = (y) => { const r = side(y, 1); return Math.min(...side(y, -1).map((q) => minSepTo(r, q))); }; // increasing in y
      let y = rearSeatY;
      if (wellGap(y) < 0) {
        const yMin = smallestX(apart, 0, y); // the two rear occupants just touch
        if (yMin == null || wellGap(yMin) < 0) return { error: "no rear seat spacing keeps the two rear occupants apart and clears the rear wheel wells by the skin offset" };
        let lo = yMin, hi = y;
        for (let i = 0; i < 60 && hi - lo > 1e-4; i++) { const m = (lo + hi) / 2; if (wellGap(m) >= 0) lo = m; else hi = m; }
        y = Math.floor(lo * 1000 + 1e-9) / 1000;
      }
      const ax = axleFor(y);
      if (ax == null) return { error: "no rear axle position within 2 m behind the rear H-point clears the rear occupants" };
      const done = y === rearSeatY && ax === rearAxleX;
      rearSeatY = y; rearAxleX = ax;
      if (done) break;
    }
    wellNote = `rearSeatY = the largest rear seat centreline y (<= the design's ${c.rearSeatY} m, bisection, rounded down to 1 mm) at which every rear occupant box is ${clearanceM} m (the body's skin offset) clear of a box bounding the rear wheel well (radius ${r4(R)} m, inner wall y ${r4(yIn)} m) and the two rear occupants do not overlap; solved alternately with rearAxleX to a fixed point`;
  }
  const boxes = rearOccAt(rearSgRPX, rearSeatY).flatMap((o) => o.boxes);
  const minSep = (b) => minSepTo(boxes, b);
  let fuelCellCenter = null;
  if (fuelDimsM) {
    const [a, b, h] = fuelDimsM;
    const zc = dz + d.heightM / 2 + c.fuelClearanceM + h / 2;
    const fuelAt = (x) => aabb({ id: "FUEL_CELL", min: [x - a / 2, -b / 2, zc - h / 2], max: [x + a / 2, b / 2, zc + h / 2] });
    const fx = smallestX((x) => minSep(fuelAt(x)) - c.fuelClearanceM, rearSgRPX, rearSgRPX + 2);
    if (fx != null) fuelCellCenter = [mmUp(fx), 0, Math.round(zc * 1e4) / 1e4];
  }
  return {
    rearSgRPX, rearAxleX, rearSeatY, fuelCellCenter,
    inputs: { sgRPFrontX: r4(sgRPFrontX), frontSeatRearX: r4(seatRearX), kneeAheadOfHPointM: r4(kneeAhead), occupants: keys },
    method: [
      `rearSgRPX = front seat rear at the SgRP-front (${r4(seatRearX)} m, seat envelope incl. the backrest allowance) + J1100 L48 ${J.L48.subtractMm} mm + rearKneeMarginM + the largest knee-pivot lead of any occupant (${r4(kneeAhead)} m), rounded up to 1 mm`,
      `rearAxleX = smallest axle x (bisection, 0.1 mm, rounded up to 1 mm) at which the differential envelope (on the axle, centre at tyre-radius height${c.diffRiseM ? ` + diffRiseM ${r4(c.diffRiseM)} m` : ""}) is diffClearanceM behind every rear occupant box of every percentile (separating-axis gap)`,
      "fuelCellCenter: bottom fuelClearanceM above the differential envelope's top; the smallest x at which it is fuelClearanceM clear of every rear occupant box",
      wellNote || "rearSeatY: the design's (no rear wheel-well constraint given)",
    ],
  };
}

/**
 * Ground clearance (layout revision 2.1): the lowest enclosed envelopes set the body's floor (the CAD body
 * puts its floor the skin offset plus the floor-corner allowance below the lowest enclosed point), so a
 * ground-clearance target is met by raising every envelope bottom to
 *   requiredBottomZ = target + skinOffset + floorCornerAllowance.
 * The binding envelopes on this car are the cabin floor (occupant feet and seat cushions sit on floorZ),
 * the engine (engineBottomZ) and the differential (centred on the rear axle; raised by diffRiseM).
 * hold = "posture": H30 / H31 / H17 unchanged, so the occupants (and the roof over them) rise with the floor.
 * hold = "hPoint": H30 / H31 / H17 reduced by the floor rise, so the H-points and steering wheel stay where
 *   they were and the heel points rise (a more legs-forward posture; H30 is checked against J1100 Class A).
 * Returns { overrides, rows, tradeoffs, requiredBottomZ } (overrides: choice entries with their basis).
 */
export const GROUND_CLEARANCE_CHOICES = Object.freeze({
  groundClearanceTargetM: { value: 0.1, basis: "design choice (brief 2026-10-09: raise the ground clearance toward >= 100 mm)" },
});

export function deriveGroundClearance({ choices, targetM = GROUND_CLEARANCE_CHOICES.groundClearanceTargetM.value, skinOffsetM, floorCornerAllowanceM, tyreR, diffDims, track, hold = "hPoint" }) {
  const c = Object.fromEntries(Object.entries(choices).map(([k, v]) => [k, v.value]));
  const req = r4(targetM + skinOffsetM + floorCornerAllowanceM);
  const how = `requiredBottomZ = target ${r4(targetM)} + skin offset ${r4(skinOffsetM)} + floor-corner allowance ${r4(floorCornerAllowanceM)} = ${req} m`;
  const overrides = {};
  const rows = [];
  const tradeoffs = [];
  const dFloor = Math.max(0, r4(req - c.floorZ));
  if (dFloor > 0) {
    overrides.floorZ = { value: req, basis: `derived: ${how}; the cabin floor (heel rest surface, under the occupant feet and seat cushions) raised to it` };
    rows.push({ parameter: "floorZ", old: c.floorZ, new: req, unit: "m", change: dFloor, reason: `ground clearance: the occupant feet and seat cushions sit on the cabin floor (${c.floorZ} m), which put the CAD body floor ${r4(c.floorZ - skinOffsetM - floorCornerAllowanceM)} m above the ground`, basis: "derived" });
    if (hold === "hPoint") {
      for (const k of ["h30", "rearH31", "steeringWheelH17"]) {
        overrides[k] = { value: r4(c[k] - dFloor), basis: `derived: ${choices[k].basis.replace(/^design choice:\s*/, "")} reduced by the floor rise (${dFloor} m) so the H-points and steering wheel stay where they were` };
        rows.push({ parameter: k, old: c[k], new: r4(c[k] - dFloor), unit: "m", change: -dFloor, reason: "holds the H-point (and the steering wheel) at its height while the floor rises: the heel point comes up instead", basis: "derived" });
      }
      tradeoffs.push({ item: "seating posture", note: `H30 ${Math.round(c.h30 * 1000)} -> ${Math.round((c.h30 - dFloor) * 1000)} mm (J1100 Class A 127-405 mm, checked by package.occupant-fit); knees rise relative to the hips; roof and frontal area unchanged by the floor` });
    } else {
      tradeoffs.push({ item: "occupant and roof height", note: `the H-points, steering wheel and heads rise ${Math.round(dFloor * 1000)} mm with the floor; the CAD body's roof and frontal area grow (computed by cad.body)` });
    }
  }
  if (c.engineBottomZ < req) {
    overrides.engineBottomZ = { value: req, basis: `derived: ${how}` };
    rows.push({ parameter: "engineBottomZ", old: c.engineBottomZ, new: req, unit: "m", change: r4(req - c.engineBottomZ), reason: "ground clearance: the engine envelope's bottom", basis: "derived" });
    tradeoffs.push({ item: "engine and crank height", note: `crank axis (and the transmission on it) ${Math.round((req - c.engineBottomZ) * 1000)} mm higher: the vehicle CG rises (computed by the mass solvers)` });
  }
  if (diffDims?.heightM && tyreR) {
    const bottom = tyreR + (c.diffRiseM || 0) - diffDims.heightM / 2;
    if (bottom < req) {
      const rise = Math.ceil((req - tyreR + diffDims.heightM / 2) * 1000 - 1e-9) / 1000;
      overrides.diffRiseM = { value: rise, basis: `derived: ${how}; the differential envelope's bottom (centre at tyre radius ${r4(tyreR)} m, envelope height ${r4(diffDims.heightM)} m: the published shipping box, an upper bound) raised to it, rounded up to 1 mm` };
      rows.push({ parameter: "diffRiseM", old: c.diffRiseM || 0, new: rise, unit: "m", change: rise, reason: `ground clearance: the differential envelope's bottom was ${r4(bottom)} m (the lowest enclosed point of the car)`, basis: "derived" });
      if (track && diffDims.widthM) {
        const run = track / 2 - diffDims.widthM / 2;
        const deg = Math.round((Math.atan2(rise, run) * 180) / Math.PI * 100) / 100;
        tradeoffs.push({ item: "rear halfshaft angle", value: deg, unit: "deg", note: `computed screening value: static halfshaft angle = atan(diffRiseM ${rise} m / (half track ${r4(track / 2)} m - half differential envelope width ${r4(diffDims.widthM / 2)} m)); the CV joints' angle limits are not in the library, so it is not checked; the envelope is the shipping box, so the real housing's bottom (and the rise it needs) is likely smaller` });
      }
    }
  }
  return { requiredBottomZ: req, overrides, rows, tradeoffs, method: how, hold };
}
