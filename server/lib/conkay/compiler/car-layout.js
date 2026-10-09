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
    place("DIFFERENTIAL", df, [d.lengthM / 2, d.widthM / 2, d.heightM / 2], [rearAxleX, 0, tyreR], { lengthM: d.lengthM, widthM: d.widthM, heightM: d.heightM, ...dimSrc(df) }, "centred on the rear axle at axle height (tyre radius)");
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
