// server/lib/conkay/compiler/car-from-library.js
//
// The car brief, built from real parts. The brief compiles to the
// road-vehicle system tree (architectures.js); then every critical component
// is picked from the library by applicability (the lightest entry that fits
// the configuration, per axle or seat position where that matters) and
// placed in the tree with its published mass, mass state, source and what
// the published mass excludes. The running gear is a family with published
// fitment (S550 Mustang suspension, steering, brakes and Super 8.8 IRS), so
// one part's fit can be checked against the others. The body and chassis
// keep their designed geometry (mass computed from geometry × density).
// What the library can't settle (an unrated torque capacity, the tyre's
// 300 km/h against the model's unlimited top speed) stays visible in the
// acceptance result. An electronic speed limiter is a design choice
// (designSpeedLimiter): it caps the top speed between the required speed and
// the tyre's established speed, and the unlimited model output is still
// reported. The package layout (car-layout.js) places the components from
// their library dimensions and sets the seating design; occupant fit and
// interference are checked on it (packaging: false leaves it out).

import { compileBrief } from "./architectures.js";
import { openDesign } from "../index.js";
import { selectComponent, massStateOf, checkApplicability, getComponent, governingCvJointLimit } from "../components/index.js";
import { layoutCar, steeringLockDeg, deriveRearPackage, deriveGroundClearance, LAYOUT_DESIGN_CHOICES, LAYOUT_REVISION_CHOICES, GROUND_CLEARANCE_CHOICES } from "./car-layout.js";
import { PACKAGING_REFERENCES, occupantDims } from "../packaging/occupant.js";
import { umtriHPointX } from "../packaging/checks.js";
import { CAD_BODY_DEFAULTS, CAD_BODY_MATERIAL, CAD_BODY_BASIS, cadBodyGeometry } from "../cad/body-params.js";

const OCCUPANT_KG = 77; // matches the architecture's occupant payload (assumption)

// Speed limiter overshoot allowance (km/h): a design requirement on the
// limiter, not a published capability. Directive 92/24/EEC (Annex III
// 1.1.4.2) accepts a stabilised speed up to 5% of the set speed or 5 km/h
// above it, whichever is greater, plus a 5% transient; at ~295 km/h 5% is
// ~15 km/h, wider than the whole band between a 180 mph requirement and a
// 300 km/h tyre. So the limiter here must hold the Directive's 5 km/h
// absolute figure as its total overshoot, which is unverified.
export const SPEED_LIMITER_OVERSHOOT_KMH = 5;
const LIMITER_SOURCES = [
  { title: "Council Directive 92/24/EEC relating to speed limitation devices or similar speed limitation on-board systems of certain categories of motor vehicles (consolidated 17.02.2004), Annex III 1.1.4.2", url: "https://www.legislation.gov.uk/eudr/1992/24/pdfs/eudr_19920024_2004-02-17_en.pdf", retrieved: "2026-10-09", note: "Vstab ≤ Vset + max(5% of Vset, 5 km/h); transient ≤ Vstab + 5%; stabilised variation ≤ max(4%, 2 km/h). Written for heavy vehicles (M2, M3, N2, N3); quoted for the size of a regulatory tolerance, not as a requirement on this car." },
];

/**
 * The speed-limiter design choice: the highest set point whose set point +
 * overshoot allowance stays within the tyre's established speed, provided it
 * is at or above the required top speed. Returns the props.vehicle.speedLimiter
 * object, or { error } when no set point fits.
 */
export function designSpeedLimiter({ requiredKmh, tyreEstablishedKmh, overshootAllowanceKmh = SPEED_LIMITER_OVERSHOOT_KMH, tyreBasis = "" }) {
  if (!Number.isFinite(requiredKmh) || !Number.isFinite(tyreEstablishedKmh)) return { error: "needs the required top speed and the tyre's established speed" };
  const setKmh = tyreEstablishedKmh - overshootAllowanceKmh;
  if (setKmh < requiredKmh) return { error: `no set point fits: the tyre's ${tyreEstablishedKmh} km/h minus the ${overshootAllowanceKmh} km/h overshoot allowance is ${setKmh} km/h, below the required ${requiredKmh.toFixed(1)} km/h` };
  const r = (x) => Math.round(x * 10) / 10;
  return {
    setKmh,
    overshootAllowanceKmh,
    basis: `design choice: set point = tyre established speed ${tyreEstablishedKmh} km/h${tyreBasis ? ` (${tyreBasis})` : ""} − overshoot allowance ${overshootAllowanceKmh} km/h = ${setKmh} km/h (${r(setKmh / 1.609344)} mph). Margins: ${r(setKmh - requiredKmh)} km/h (${r((setKmh / requiredKmh - 1) * 100)}%) above the required ${r(requiredKmh)} km/h (${r(requiredKmh / 1.609344)} mph); set point + allowance = ${setKmh + overshootAllowanceKmh} km/h, at the tyre's established speed. The allowance is a design requirement on the limiter (unverified), tighter than the Directive 92/24/EEC test tolerance.`,
    sources: LIMITER_SOURCES,
  };
}
const metres = (n) => `${n} m`;

/** The configuration components are checked against, with where each value comes from. */
export function vehicleConfiguration(parsed, overrides = {}) {
  const req = Object.fromEntries((parsed.requirements || []).map((r) => [r.metric, r]));
  const massMax = req.mass?.max?.si ?? null;
  const vReq = req.topSpeed?.min?.si ?? null;
  const seats = req.seats?.min?.si ?? null;
  const config = {
    fuelType: "gasoline",
    drivetrain: "RWD",
    transmissionType: "manual",
    frontSuspension: "Ford S550 Mustang front (2015-2023)",
    rearSuspension: "Ford S550 IRS (2015-2023 Mustang)",
    boltPattern: "5x114.3",
    wheelDiameterIn: 18,
    vehicleMassKg: massMax,
    requiredTopSpeedKmh: Number.isFinite(vReq) ? vReq * 3.6 : null,
    loadPerTyreKg: Number.isFinite(massMax) && Number.isFinite(seats) ? (massMax + seats * OCCUPANT_KG) / 4 : null,
    seatHipBreadthM: Math.max(...PACKAGING_OCCUPANTS.map((k) => occupantDims(k).hipBreadthSitting)),
    provides: [],
    ...overrides,
  };
  const sources = {
    fuelType: overrides.fuelType ? "given" : "design choice: the brief does not name an energy source",
    drivetrain: overrides.drivetrain ? "given" : "design choice (rear-wheel drive)",
    transmissionType: overrides.transmissionType ? "given" : "design choice (manual: Coyote V8 + TREMEC manual)",
    frontSuspension: overrides.frontSuspension ? "given" : "design choice: S550 Mustang running gear, so suspension, steering, brakes and axle have published fitment to each other",
    rearSuspension: overrides.rearSuspension ? "given" : "design choice: S550 Mustang IRS (see frontSuspension)",
    boltPattern: overrides.boltPattern ? "given" : "design choice (5x114.3 hub pattern)",
    wheelDiameterIn: overrides.wheelDiameterIn ? "given" : "design choice (18 in wheels)",
    vehicleMassKg: "brief: mass target (max)",
    requiredTopSpeedKmh: "brief: top-speed target (min)",
    loadPerTyreKg: `(mass target + ${seats ?? "?"} occupants × ${OCCUPANT_KG} kg) / 4, static, even split (screening)`,
    seatHipBreadthM: `ANSUR II hip breadth, sitting: the widest of the checked occupants (${PACKAGING_OCCUPANTS.join(", ")}); a seat must take it (max cushion width)`,
  };
  return { config, sources };
}

function pick(category, config, selection, { key = category, where, extra } = {}) {
  const r = selectComponent(category, config, { extra, where });
  selection[key] = { chosen: r.chosen?.id || null, candidates: r.candidates };
  return r.chosen;
}

const at = (x, z, y = 0) => ({ x: metres(x), y: metres(y), z: metres(z) });

function libraryNode(entry, { id, kind, critical, config, position, share = 1, props = {} }) {
  const ms = massStateOf(entry);
  const kg = entry.mass.kg * share;
  if (share !== 1) {
    // One seat position of a multi-position part: its share of the measured mass.
    ms.variant = `${ms.variant || entry.variant} (one of ${Math.round(1 / share)} positions: ${share === 0.5 ? "half" : `${share} ×`} the published ${entry.mass.kg} kg)`;
    if (ms.uncertainty?.lowKg != null) ms.uncertainty = { lowKg: ms.uncertainty.lowKg * share, highKg: ms.uncertainty.highKg * share };
  }
  return {
    id, kind, name: `${entry.manufacturer} ${entry.model} (${entry.variant})`,
    position,
    props: {
      critical,
      component: entry.id,
      mass: `${kg} kg`,
      massState: ms,
      massExcludes: entry.mass.excludes || [],
      applicability: checkApplicability(entry, config),
      ...props,
    },
  };
}

/**
 * Compile the brief, pick library components and return { ir, configuration,
 * selection } or { error }.
 */
export function buildCarFromLibrary(brief, { config: overrides, speedLimiter = true, packaging = true, occupantKeys = PACKAGING_OCCUPANTS, layoutChoices, layout = "derived", cadBody = true, bodyParams, groundClearance = {} } = {}) {
  const c = compileBrief(brief);
  if (c.error) return { error: c.error };
  if (c.architecture !== "road-vehicle") return { error: `no component flow for a ${c.architecture} yet` };
  const { config, sources } = vehicleConfiguration(c.parsed, overrides);
  const selection = {};
  const ir = c.ir;
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  const edges = ir.edges;
  const add = (parent, node) => { ir.nodes.push(node); byId.set(node.id, node); edges.push({ type: "CONTAINS", from: parent, to: node.id }); };
  const replace = (node) => { const i = ir.nodes.findIndex((n) => n.id === node.id); ir.nodes[i] = node; byId.set(node.id, node); };

  // Engine or motor.
  const engine = pick("engine_or_motor", config, selection);
  if (engine) {
    config.engineId = engine.id;
    config.engineTorqueNm = engine.ratings.peakTorqueNm?.value ?? null;
    config.enginePattern = engine.applicability.transmissionPattern ?? null;
    config.engineMaxRpm = engine.ratings.redlineRpm?.value ?? engine.ratings.maxSpeedRpm?.value ?? null;
    const rl = engine.ratings.redlineRpm;
    replace(libraryNode(engine, {
      id: "ENGINE", kind: "Actuator", critical: "engine_or_motor", config, position: at(3.3, 0.5),
      props: {
        maxPower: `${engine.ratings.peakPowerW.value} W`,
        maxPowerSource: `${engine.ratings.peakPowerW.published} (${engine.mass.massState.source.title})`,
        ...(Number.isFinite(engine.ratings.peakPowerW.rpm) ? { peakPowerRpm: engine.ratings.peakPowerW.rpm } : {}),
        ...(Number.isFinite(rl?.value) ? {
          redlineRpm: rl.value,
          redlineBasis: rl.state === "estimated" ? `estimated: ${rl.method}` : `published: ${rl.published || ""}`,
          ...(rl.range ? { redlineRange: rl.range } : {}),
        } : {}),
      },
    }));
  }
  // Engine wiring: the control pack made for this engine.
  const wiring = pick("wiring", config, selection);
  if (wiring) add("ELECTRICAL", libraryNode(wiring, { id: "CONTROL_PACK", kind: "Part", critical: "wiring", config, position: at(2.6, 0.6) }));
  // Transmission (must take the engine's torque and bolt to its pattern).
  const gearbox = pick("transmission", config, selection);
  if (gearbox) {
    add("DRIVELINE", libraryNode(gearbox, {
      id: "TRANSMISSION", kind: "Part", critical: "transmission", config, position: at(3.7, 0.35),
      props: Number.isFinite(gearbox.ratings.maxInputRpm?.value) ? { maxInputRpm: gearbox.ratings.maxInputRpm.value } : {},
    }));
  }
  // Differential and rear axle: must fit the rear suspension.
  const diff = pick("differential", config, selection);
  if (diff) add("DRIVELINE", libraryNode(diff, { id: "DIFFERENTIAL", kind: "Part", critical: "differential", config, position: at(3.7, 0.33) }));
  // Suspension, front and rear; the front one provides the spindle the brakes bolt to.
  const suspF = pick("suspension", config, selection, { key: "suspension_front", where: (c) => c.applicability.axle === "front" });
  if (suspF) {
    if (suspF.applicability.provides?.spindle) config.spindle = suspF.applicability.provides.spindle;
    add("SUSPENSION", libraryNode(suspF, { id: "SUSPENSION_FRONT", kind: "Part", critical: "suspension", config, position: at(1.0, 0.35), props: { axle: "front" } }));
  }
  const suspR = pick("suspension", config, selection, { key: "suspension_rear", where: (c) => c.applicability.axle === "rear" });
  if (suspR) add("SUSPENSION", libraryNode(suspR, { id: "SUSPENSION_REAR", kind: "Part", critical: "suspension", config, position: at(3.7, 0.35), props: { axle: "rear" } }));
  const steering = pick("steering", config, selection);
  if (steering) add("SUSPENSION", libraryNode(steering, { id: "STEERING_RACK", kind: "Part", critical: "steering", config, position: at(1.1, 0.3) }));
  // Wheels, then tyres that fit them.
  const wheel = pick("wheels", config, selection);
  if (wheel) {
    config.wheelWidthIn = wheel.dimensions.widthIn;
    for (const [p, x] of [["FL", 1.0], ["FR", 1.0], ["RL", 3.7], ["RR", 3.7]]) {
      add("WHEELS", libraryNode(wheel, { id: `WHEEL_${p}`, kind: "Part", critical: "wheels", config, position: at(x, 0.33, p.endsWith("L") ? -0.8 : 0.8) }));
    }
  }
  const tyre = pick("tyres", config, selection);
  if (tyre) {
    for (const [p, x] of [["FL", 1.0], ["FR", 1.0], ["RL", 3.7], ["RR", 3.7]]) {
      replace(libraryNode(tyre, {
        id: `TIRE_${p}`, kind: "Tire", critical: "tyres", config, position: at(x, 0.33, p.endsWith("L") ? -0.8 : 0.8),
        props: { speedRating: tyre.ratings.speedSymbol, loadIndex: tyre.ratings.loadIndex },
      }));
    }
  }
  // Brakes, one kit per axle.
  for (const [axle, x] of [["front", 1.0], ["rear", 3.7]]) {
    const kit = pick("brakes", config, selection, { key: `brakes_${axle}`, where: (c) => c.applicability.axle === axle });
    if (kit) add("BRAKES", libraryNode(kit, { id: `BRAKES_${axle.toUpperCase()}`, kind: "Part", critical: "brakes", config, position: at(x, 0.33), props: { axle } }));
  }
  // Cooling, exhaust (combustion only) and fuel.
  const cooling = pick("cooling", config, selection);
  if (cooling) add("POWERTRAIN", libraryNode(cooling, { id: "RADIATOR", kind: "Part", critical: "cooling", config, position: at(0.6, 0.45) }));
  if (config.fuelType !== "electric") {
    const exhaust = pick("exhaust", config, selection);
    if (exhaust) add("POWERTRAIN", libraryNode(exhaust, { id: "EXHAUST", kind: "Part", critical: "exhaust", config, position: at(3.0, 0.2) }));
  }
  const fuel = pick("fuel_or_battery", config, selection);
  if (fuel) add("POWERTRAIN", libraryNode(fuel, { id: "FUEL_CELL", kind: "Part", critical: "fuel_or_battery", config, position: at(2.9, 0.3) }));

  // Designed geometry: mass computed from geometry × density.
  const part = (id, material, geometry, x, z) => ({ id, kind: "Part", material, geometry, position: at(x, z) });
  const shell = (area, thickness) => ({ shape: "shell", area, thickness });
  if (packaging && cadBody) {
    // The CAD body (cad.body): a lofted B-spline skin around the occupant and component envelopes.
    const bp = { ...CAD_BODY_DEFAULTS, ...(bodyParams || {}) };
    add("BODY", { ...part("BODY_SHELL", CAD_BODY_MATERIAL, cadBodyGeometry(bp), 2.3, 0.7), props: { body: { vehicle: "VEH", plies: bp.plies, basis: CAD_BODY_BASIS } } });
  } else {
    add("BODY", part("BODY_SHELL", "cfrp-quasi-iso", { shape: "ellipsoid-shell", length: "4.4 m", width: "1.9 m", height: "1.2 m", thickness: "3 mm" }, 2.3, 0.7));
  }
  add("BODY", part("GLAZING", "glass-soda-lime", shell("2.2 m2", "4 mm"), 2.0, 1.0));
  for (const side of ["L", "R"]) {
    add("CHASSIS", { ...part(`RAIL_${side}`, "aluminum-6061-t6", { shape: "i-beam", length: "3.6 m", height: "120 mm", flangeWidth: "80 mm", flangeThickness: "6 mm", webThickness: "4 mm" }, 2.3, 0.25), kind: "Beam", props: { role: "rail" } });
  }
  add("CHASSIS", part("TUB", "cfrp-quasi-iso", shell("6 m2", "5 mm"), 2.2, 0.35));

  // Seats: front positions and rear positions from the library.
  const seatF = pick("interior_seats", config, selection, { key: "seats_front", where: (c) => c.applicability.seatPosition === "front" });
  const seatR = pick("interior_seats", config, selection, { key: "seats_rear", where: (c) => c.applicability.seatPosition === "rear" });
  for (let i = 1; byId.has(`SEAT_${i}`); i++) {
    const entry = i <= 2 ? seatF : seatR;
    const old = byId.get(`SEAT_${i}`);
    if (!entry) { replace({ ...old, props: { ...old.props, massState: { state: "placeholder", note: "no library seat for this position" } } }); continue; }
    const share = 1 / (entry.applicability.positions || 1);
    replace({ ...libraryNode(entry, { id: `SEAT_${i}`, kind: "Seat", critical: "interior_seats", config, share, position: at(i <= 2 ? 2.0 : 2.9, 0.45) }), name: `Seat ${i}: ${entry.manufacturer} ${entry.model}` });
  }
  for (let i = 1; byId.has(`OCCUPANT_${i}`); i++) {
    const o = byId.get(`OCCUPANT_${i}`);
    replace({ ...o, position: at(i <= 2 ? 2.0 : 2.9, 0.6) });
  }
  // A part's listing may exclude something another selected part supplies
  // (the engine's control pack, hoses that come with it): that is not missing
  // mass, so it moves to massCoveredElsewhere.
  const chosen = ir.nodes.filter((n) => n.props?.component).map((n) => getComponent(n.props.component));
  const supplied = (x) => {
    if (/\b(counted with|comes? with|included with)\b/i.test(x)) return true;
    const pns = x.match(/\bM-\d{4}-[A-Z0-9]+\b/gi) || [];
    return pns.some((pn) => chosen.some((c) => c.id.toLowerCase().includes(pn.toLowerCase())));
  };
  for (const n of ir.nodes.filter((x) => Array.isArray(x.props?.massExcludes))) {
    const ex = n.props.massExcludes;
    n.props.massExcludes = ex.filter((x) => !supplied(x));
    const covered = ex.filter(supplied);
    if (covered.length) n.props.massCoveredElsewhere = covered;
  }
  // The architecture tagged the assemblies; the parts above carry the tags now.
  for (const id of ["SUSPENSION", "BRAKES", "ELECTRICAL"]) {
    const { critical: _tag, ...rest } = byId.get(id).props || {};
    replace({ ...byId.get(id), props: rest });
  }

  // Vehicle inputs. Cd and losses are inputs, which is why the top speed is a model output.
  const veh = byId.get("VEH");
  veh.props = {
    ...veh.props,
    vehicle: {
      fuelType: config.fuelType,
      dragCoefficient: 0.28,
      dragCoefficientSource: "design target (not computed: no CFD or wind-tunnel value)",
      frontalAreaFrom: "BODY_SHELL",
      rollingResistance: 0.011,
      drivelineEfficiency: 0.9,
      frontAxleX: "1.0 m",
      rearAxleX: "3.7 m",
      ...(tyre ? { tireRadius: `${tyre.dimensions.overallDiameterM / 2} m` } : {}),
      ...(gearbox ? { gearRatios: gearbox.ratings.gearRatios } : {}),
      ...(Number.isFinite(diff?.ratings?.finalDrive?.value) ? {
        finalDrive: diff.ratings.finalDrive.value,
        finalDriveSource: `${diff.id}: ${diff.ratings.finalDrive.published}`,
      } : {}),
    },
  };
  // Package layout: component positions from library dimensions and the seating design (car-layout.js).
  if (packaging) applyLayout({ ir, byId, veh, selection, occupantKeys, layoutChoices, layout, seatF, sources, body: { ...CAD_BODY_DEFAULTS, ...(bodyParams || {}) }, groundClearance });
  // Electronic speed limiter: a design choice between the required top speed
  // and the tyre's established speed (pass speedLimiter: false to leave it out).
  let limiter = null;
  if (speedLimiter && tyre) {
    const est = tyre.applicability.establishedMaxSpeedKmh;
    const d = speedLimiter === true
      ? designSpeedLimiter({ requiredKmh: config.requiredTopSpeedKmh, tyreEstablishedKmh: est, tyreBasis: `${tyre.ratings.speedSymbol}, ${tyre.id}` })
      : speedLimiter;
    limiter = d;
    if (!d.error) veh.props.vehicle.speedLimiter = d;
  }
  sources.speedLimiter = !limiter ? "none (no speed limiter in this design)" : limiter.error ? `not applied: ${limiter.error}` : limiter.basis;
  return { ir, configuration: { config, sources }, selection, parsed: c.parsed, speedLimiter: limiter };
}

// Occupants checked by default: the smallest (5th female stature) and largest (95th male) occupant,
// and the 95th female (the widest hips in the ANSUR II tables).
export const PACKAGING_OCCUPANTS = ["F5", "F95", "M95"];

function applyLayout({ ir, byId, veh, selection, occupantKeys, layoutChoices, layout, seatF, sources, body = null, groundClearance = null }) {
  const entry = (k) => { const id = selection[k]?.chosen; return id ? getComponent(id) : null; };
  const v = veh.props.vehicle;
  const frontAxleX = parseFloat(v.frontAxleX);
  let rearAxleX = parseFloat(v.rearAxleX);
  const tyreY = byId.get("TIRE_FL")?.position?.y;
  const track = tyreY ? 2 * Math.abs(parseFloat(tyreY)) : null; // design choice in this build
  if (!Number.isFinite(track)) return;
  let choices = layoutChoices || LAYOUT_DESIGN_CHOICES;
  let revision = null;
  if (!layoutChoices && layout === "derived") {
    // Layout revision 2: the rear package derived from the envelopes (car-layout.js deriveRearPackage).
    let base = { ...LAYOUT_DESIGN_CHOICES, ...LAYOUT_REVISION_CHOICES };
    const tyreE = entry("tyres"), diffE = entry("differential"), fuelE = entry("fuel_or_battery");
    // Layout revision 2.1: ground clearance (car-layout.js deriveGroundClearance), before the rear package
    // is derived (the rear H-point height and the differential height feed it).
    let gc = null;
    if (groundClearance && body && tyreE?.dimensions?.overallDiameterM) {
      const targetM = groundClearance.targetM ?? GROUND_CLEARANCE_CHOICES.groundClearanceTargetM.value;
      gc = deriveGroundClearance({ choices: base, targetM, skinOffsetM: body.skinOffsetM, floorCornerAllowanceM: body.floorCornerAllowanceM, tyreR: tyreE.dimensions.overallDiameterM / 2, diffDims: diffE?.dimensions, track, hold: groundClearance.hold || "hPoint", cvJointLimit: governingCvJointLimit() });
      base = { ...base, ...gc.overrides, groundClearanceTargetM: { value: targetM, basis: GROUND_CLEARANCE_CHOICES.groundClearanceTargetM.basis } };
    }
    const der = deriveRearPackage({
      choices: base, keys: [...new Set([...occupantKeys, "M95"])], seatDims: seatF?.dimensions,
      diffDims: diffE?.dimensions, fuelDimsM: fuelE?.dimensions?.fitsInternalContainerMm?.map((x) => x / 1000), tyreR: tyreE ? tyreE.dimensions.overallDiameterM / 2 : null,
        rearWell: body && tyreE?.dimensions?.sectionWidthM ? { track, tyreHalfWidthM: tyreE.dimensions.sectionWidthM / 2, archClearanceM: body.archClearanceM, clearanceM: body.skinOffsetM } : null,
    });
    // (a derivation error leaves the v1 layout in place; the checks then report its failures)
    if (!der.error) {
      const derived = (value, i) => ({ value, basis: `derived: ${der.method[i]}` });
      choices = { ...base, rearSgRPX: derived(der.rearSgRPX, 0), ...(der.rearSeatY !== base.rearSeatY.value ? { rearSeatY: derived(der.rearSeatY, 3) } : {}), ...(der.fuelCellCenter ? { fuelCellCenter: derived(der.fuelCellCenter, 2) } : {}) };
      const oldRear = rearAxleX;
      rearAxleX = der.rearAxleX;
      v.rearAxleX = `${rearAxleX} m`;
      for (const id of ["SUSPENSION_REAR", "BRAKES_REAR", "DIFFERENTIAL", "WHEEL_RL", "WHEEL_RR", "TIRE_RL", "TIRE_RR"]) {
        const n = byId.get(id);
        if (n?.position) n.position = { ...n.position, x: `${rearAxleX} m` };
      }
      const r4 = (x) => Math.round(x * 1e4) / 1e4;
      revision = {
        version: gc ? "2.1.0" : "2.0.0",
        inputs: der.inputs,
        ...(gc ? { groundClearance: { targetM: base.groundClearanceTargetM.value, requiredBottomZ: gc.requiredBottomZ, hold: gc.hold, method: gc.method, tradeoffs: gc.tradeoffs } } : {}),
        changes: [
          { parameter: "front seat", old: "RECARO Pole Position N.G. (FIA): max cushion width 385 mm, 8.8 kg", new: `${seatF?.manufacturer} ${seatF?.model}: max cushion width ${Math.round((seatF?.dimensions?.maxCushionWidthM || 0) * 1000)} mm, ${seatF?.mass?.kg} kg`, reason: "#1039: the 95th female (456 mm) and 95th male (431 mm) sitting hip breadths exceed the Pole Position's 385 mm cushion; the seat must take the widest checked occupant (applicability maxCushionWidthM >= seatHipBreadthM)", basis: "sourced (RECARO hotsheet)" },
          { parameter: "frontSeatBackThicknessM", old: 0, new: base.frontSeatBackThicknessM.value, unit: "m", reason: "the seat envelope was a plane on the occupant's back (a lower bound); the rear knee room needs the back of the seatback", basis: "design" },
          { parameter: "rearSgRPX", old: LAYOUT_DESIGN_CHOICES.rearSgRPX.value, new: der.rearSgRPX, unit: "m", change: r4(der.rearSgRPX - LAYOUT_DESIGN_CHOICES.rearSgRPX.value), reason: "#1039: M95 rear knee L48 was -9.3 mm; derived so every percentile has L48 >= the knee margin", basis: "derived" },
          ...(der.rearSeatY !== base.rearSeatY.value ? [{ parameter: "rearSeatY", old: base.rearSeatY.value, new: der.rearSeatY, unit: "m", change: r4(der.rearSeatY - base.rearSeatY.value), reason: "the CAD body's rear wheel wells: the M95 rear torso was 22 mm from the well's inner wall (under the 40 mm skin offset); the rear seats move inboard until every rear occupant clears the well by the skin offset", basis: "derived" }] : []),
          { parameter: "rearAxleX", old: oldRear, new: rearAxleX, unit: "m", change: r4(rearAxleX - oldRear), reason: "#1039: rear torso/pelvis overlapped the differential envelope by 44.8-89.8 mm; derived so the differential clears every rear occupant by diffClearanceM", basis: "derived" },
          { parameter: "wheelbase", old: r4(oldRear - frontAxleX), new: r4(rearAxleX - frontAxleX), unit: "m", change: r4(rearAxleX - oldRear), reason: "follows the rear axle (front axle unchanged)", basis: "derived" },
          ...(der.fuelCellCenter ? [{ parameter: "fuelCellCenter", old: LAYOUT_DESIGN_CHOICES.fuelCellCenter.value, new: der.fuelCellCenter, unit: "m", reason: "re-placed above the moved differential and clear of the rear occupants (was 17.7 mm from the differential)", basis: "derived" }] : []),
          { parameter: "rearKneeMarginM / diffClearanceM / fuelClearanceM", old: null, new: [base.rearKneeMarginM.value, base.diffClearanceM.value, base.fuelClearanceM.value], unit: "m", reason: "the margins the derivation keeps", basis: "design" },
          ...(gc ? gc.rows.map((row) => ({ ...row, revision: "2.1.0" })) : []),
          { parameter: "frontAxleX, track", old: [frontAxleX, track], new: [frontAxleX, track], unit: "m", reason: "unchanged: the front package (engine bay, footwell, front seats) had no failure tied to them", basis: "design (unchanged)" },
          { parameter: "body (overall L/W/H, roof and header height, ground clearance)", old: "ellipsoid 4.4 x 1.9 x 1.2 m centred at z 0.7", new: "the CAD body (cad.body): sections solved around the envelopes + skin offset; see its outputs", reason: "#1039: rear headroom, hip-to-shell and entry-height failures came from the ellipsoid", basis: "computed (kernel)" },
        ],
      };
    }
  }
  const lay = layoutCar({ entries: { engine: entry("engine_or_motor"), gearbox: entry("transmission"), diff: entry("differential"), cooling: entry("cooling"), fuel: entry("fuel_or_battery"), tyre: entry("tyres") }, frontAxleX, rearAxleX, track, choices });
  for (const [id, p] of Object.entries(lay.positions)) { const n = byId.get(id); if (n) n.position = at(p.x, p.z, p.y); }
  // Seats and occupant payload at the design H-points: front at the 50th male's UMTRI H-point (mid-track),
  // rear at the rear SgRP (payload CG taken at the H-point: an assumption).
  const c = Object.fromEntries(Object.entries(choices).map(([k, x]) => [k, x.value]));
  const prpX = c.ahpX - (PACKAGING_REFERENCES.saeJ1100.definitions.BOF.valueMm / 1000) * Math.cos((c.footAngleDeg * Math.PI) / 180);
  const hMid = prpX + umtriHPointX(occupantDims("M50").stature, c.steeringWheelL6, c.h30);
  const seatPos = (i) => (i <= 2 ? { x: hMid, y: (i === 1 ? -1 : 1) * c.frontSeatY, z: c.floorZ + c.h30 } : { x: c.rearSgRPX, y: (i === 3 ? -1 : 1) * c.rearSeatY, z: c.floorZ + c.rearH31 });
  const seats = [];
  for (let i = 1; byId.has(`SEAT_${i}`); i++) { const p = seatPos(i); byId.get(`SEAT_${i}`).position = at(+p.x.toFixed(4), p.z, p.y); seats.push(`SEAT_${i}`); }
  for (let i = 1; byId.has(`OCCUPANT_${i}`); i++) { const p = seatPos(i); byId.get(`OCCUPANT_${i}`).position = at(+p.x.toFixed(4), p.z, p.y); }
  const notChecked = [
    ...lay.notChecked,
    ...["SUSPENSION_FRONT", "SUSPENSION_REAR", "STEERING_RACK", "EXHAUST", "CONTROL_PACK"].filter((id) => byId.has(id)).map((id) => ({ item: id, reason: `no published dimensions in the library (${getComponent(byId.get(id).props.component)?.dimensions?.note || "none"})` })),
    ...["SEAT_3", "SEAT_4"].filter((id) => byId.has(id)).map((id) => ({ item: id, reason: "rear seat: no published dimensions (occupants are placed at the rear SgRP; the seat itself is not checked)" })),
    { item: "BRAKES_FRONT, BRAKES_REAR", reason: "inside the wheels (14 in rotors on 18 in wheels, fitment per the library); not checked separately" },
    { item: "RAIL_L, RAIL_R, TUB", reason: "designed chassis members with placeholder positions (both rails at y = 0), not a frame layout" },
    { item: "pedal box, dash, steering column, driveshaft, door and sill", reason: "not in the design" },
    { item: "suspension travel", reason: "S550 wheel travel is not published: tyres are checked static (front ones over the steering lock)" },
  ];
  const ref = PACKAGING_REFERENCES.referenceVehicle;
  const lock = steeringLockDeg(ref);
  const seat = seatF ? { id: seatF.id, dims: seatF.dimensions, source: seatF.dimensions.source?.url } : null;
  v.packaging = {
    version: revision ? "2.0.0" : "1.0.0",
    ...(revision ? { layoutRevision: revision } : {}),
    bodyShell: "BODY_SHELL",
    occupantKeys,
    seats,
    designChoices: choices,
    components: lay.components,
    tyres: lay.tyres,
    firewallX: lay.firewallX,
    seatFront: seat,
    steeringLock: { innerDeg: Math.round(lock.innerDeg * 10) / 10, outerDeg: Math.round(lock.outerDeg * 10) / 10, state: "estimated", method: PACKAGING_REFERENCES.steeringLock.method, inputs: PACKAGING_REFERENCES.steeringLock.inputs, source: ref.source.url },
    referenceVehicle: { label: ref.label, source: ref.source.url, inches: ref.inches, feet: ref.feet, use: ref.use },
    notChecked,
  };
  sources.packaging = "compiler/car-layout.js: positions from library dimensions and labelled design choices; occupants from ANSUR II";
}

const kgOf = (m) => (typeof m === "number" ? m : parseFloat(String(m)));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v);

/**
 * What could resolve a tyre established below the model's top speed, without
 * changing the physics: the facts for each option, cited where they come from.
 */
function tyreOptions({ b, gear, tyreEntry, load, s }) {
  if (!tyreEntry) return null;
  const est = tyreEntry.applicability.establishedMaxSpeedKmh;
  const out = { establishedKmh: est, explicitRatingAbove300: tyreEntry.ratings.explicitMaxSpeedKmh ?? null, options: [] };
  out.options.push({
    option: "a tyre with the manufacturer's explicit rating above the top speed",
    finding: tyreEntry.ratings.highSpeedNote || "no explicit manufacturer rating above 300 km/h is recorded for this tyre",
  });
  const diff = getComponent(s.graph.node("DIFFERENTIAL")?.props?.component || "");
  const ratios = b.ir.nodes.find((n) => n.id === "VEH")?.props?.vehicle?.gearRatios;
  const r = gear?.inputs?.tireRadius?.value;
  const rpm = gear?.outputs?.revLimitRpm?.value;
  if (diff?.ratings?.finalDriveOptions && Array.isArray(ratios) && Number.isFinite(r) && Number.isFinite(rpm)) {
    const top = Math.min(...ratios);
    const perRatio = diff.ratings.finalDriveOptions.values.map((fd) => {
      const kmh = (rpm * ((2 * Math.PI) / 60) * r) / (top * fd) * 3.6;
      return { finalDrive: fd, gearLimitedKmh: r1(kmh), gearLimitedMph: r1(kmh / 1.609344), withinTyre: kmh <= est };
    });
    out.options.push({
      option: "gearing: a shorter final drive so top gear runs out of revs below the tyre's established speed",
      finding: perRatio.some((x) => x.withinTyre)
        ? `available final drives that keep the gear limit within ${est} km/h: ${perRatio.filter((x) => x.withinTyre).map((x) => x.finalDrive).join(", ")}`
        : `no available final drive does: the shortest (${Math.max(...perRatio.map((x) => x.finalDrive))}) still allows ${r1(Math.min(...perRatio.map((x) => x.gearLimitedKmh)))} km/h at ${rpm} rpm in top gear (${top})`,
      perRatio,
      basis: `${diff.ratings.finalDriveOptions.published} Rev limit ${rpm} rpm (${gear.outputs.revLimitRpm.source}).`,
    });
  }
  const lim = b.ir.nodes.find((n) => n.id === "VEH")?.props?.vehicle?.speedLimiter;
  out.options.push(lim
    ? { option: "an electronic speed limit at or below the tyre's established speed", applied: true, finding: `applied as a design choice: set at ${lim.setKmh} km/h (${r1(lim.setKmh / 1.609344)} mph) with a ${lim.overshootAllowanceKmh} km/h overshoot allowance; the tyre is checked against the limited speed`, basis: lim.basis }
    : { option: "an electronic speed limit at or below the tyre's established speed", applied: false, finding: "a design decision, not applied in this build" });
  out.options.push({ option: "more drag (a higher Cd or frontal area)", finding: "Cd 0.28 is a design target, not a measurement; a measured Cd would move the drag-limited speed either way" });
  const derate = tyreEntry.ratings.highSpeedLoadDerating;
  if (derate && load?.margins?.length) {
    // The vehicle's top speed (the limiter's set point when it caps it), else
    // the required speed; the first table row at or above it (conservative).
    const vReqKmh = b.configuration.config.requiredTopSpeedKmh;
    const lim = b.ir.nodes.find((n) => n.id === "VEH")?.props?.vehicle?.speedLimiter;
    const atKmh = lim ? lim.setKmh : vReqKmh;
    const row = Number.isFinite(atKmh) ? derate.table.find((x) => x.mph * 1.609344 >= atKmh - 1e-6) : null;
    if (row) {
      const capKg = (row.loadPct / 100) * tyreEntry.applicability.maxLoadKg;
      const worst = Math.max(...load.margins.map((m) => m.demand / 9.80665));
      out.highSpeedLoad = {
        forSpeedKmh: r1(atKmh), forSpeedBasis: lim ? "speed limiter set point" : "required top speed", atMph: row.mph, inflationIncreasePsi: row.psi, loadCapacityPct: row.loadPct, capacityKg: r1(capKg), worstStaticLoadKg: r1(worst), pass: worst <= capKg,
        source: derate.source.url,
        note: "Michelin's Y-speed-rated load/inflation table, first row at or above the vehicle's top speed (conservative); static loads, no downforce or load transfer",
      };
    }
  }
  return out;
}

/**
 * Open the library-built car and report its acceptance: verdict, failures,
 * mass breakdown, critical components, tyre and top-speed status, and the
 * components with their sources.
 */
export function carAcceptance(brief, opts = {}) {
  const b = buildCarFromLibrary(brief, opts);
  if (b.error) return { ok: false, error: b.error };
  const opened = openDesign(b.ir);
  if (!opened.ok) return { ok: false, error: "the library-built design did not compile", errors: opened.errors };
  return acceptanceReport(brief, b, opened.session);
}

/**
 * carAcceptance with the external kernels (CAD body, drawing) run: the synchronous version reports them as
 * pending (NOT_COMPUTED), never blocking on a kernel; this one runs them off the request path first.
 */
export async function carAcceptanceAsync(brief, opts = {}) {
  const b = buildCarFromLibrary(brief, opts);
  if (b.error) return { ok: false, error: b.error };
  const opened = openDesign(b.ir);
  if (!opened.ok) return { ok: false, error: "the library-built design did not compile", errors: opened.errors };
  const settled = await opened.session.settle();
  const r = acceptanceReport(brief, b, opened.session);
  return r.ok ? { ...r, settled } : r;
}

function acceptanceReport(brief, b, s) {
  const acc = s.result("vehicle.acceptance@VEH");
  const bd = s.result("mass.breakdown@VEH");
  const tyre = s.result("tire.speed-rating@VEH");
  const gear = s.result("vehicle.gearing@VEH");
  const load = s.result("tire.load-index@VEH");
  const claim = acc.outputs.performanceClaims.value[0];
  const components = [...s.graph.nodes.values()].filter((n) => n.props?.component).map((n) => {
    const ms = n.props.massState;
    const entry = getComponent(n.props.component);
    return {
      node: n.id, componentId: n.props.component, name: n.name, massKg: kgOf(n.props.mass), entryMassKg: entry.mass.kg, published: entry.mass.published, state: ms.state,
      ...(ms.sourceKind ? { sourceKind: ms.sourceKind } : {}),
      source: ms.source?.url || null, sourceTitle: ms.source?.title || null, ...(ms.uncertainty ? { uncertainty: ms.uncertainty, method: ms.method } : {}),
      excludes: entry.mass.excludes || [], applicability: n.props.applicability,
    };
  });
  const sourcedBy = { manufacturer: 0, measured: 0 };
  for (const c of components.filter((x) => x.state === "sourced")) sourcedBy[c.sourceKind ? "measured" : "manufacturer"] += c.massKg;
  const targetKg = b.configuration.config.vehicleMassKg;
  const totalKg = bd.outputs.totalMass.value;
  const tyreEntry = getComponent(components.find((c) => c.node === "TIRE_FL")?.componentId || "");
  const report_tyreOptions = tyreOptions({ b, gear, tyreEntry, load, s });
  return {
    ok: true,
    session: s,
    report: {
      brief,
      configuration: b.configuration,
      selection: b.selection,
      verdict: acc.outputs.verdict.value,
      status: acc.status,
      failures: acc.failures || [],
      massBreakdown: {
        totalKg: r1(bd.outputs.totalMass.value),
        note: bd.outputs.totalMass.note,
        pct: { sourced: r1(bd.outputs.sourcedPct.value), estimated: r1(bd.outputs.estimatedPct.value), computed: r1(bd.outputs.computedPct.value), placeholder: r1(bd.outputs.placeholderPct.value) },
        kg: Object.fromEntries(Object.entries(bd.outputs.byState.value).map(([k, v]) => [k, r1(v.kg)])),
        uncertaintyKg: [r1(bd.outputs.uncertaintyLow.value), r1(bd.outputs.uncertaintyHigh.value)],
        uncertaintyExcludes: bd.outputs.uncertainty.value.excludes,
        lowerBound: acc.outputs.massBreakdown.value?.lowerBound ?? null,
        vsTarget: Number.isFinite(targetKg) ? { targetKg: r1(targetKg), targetLb: r1(targetKg / 0.45359237), totalKg: r1(totalKg), totalLb: r1(totalKg / 0.45359237), marginKg: r1(targetKg - totalKg), note: "the total is a lower bound (see notIncluded), so the margin is an upper bound" } : null,
        sourcedKgBySourceKind: { manufacturerSpec: r1(sourcedBy.manufacturer), thirdPartyMeasurement: r1(sourcedBy.measured) },
        notIncluded: ["fuel load", "fluids", ...(acc.outputs.massBreakdown.value?.excluded || [])],
      },
      caveats: acc.outputs.caveats.value,
      criticalComponents: acc.outputs.criticalComponents.value.map((c) => ({ category: c.category, status: c.status, parts: (c.parts || []).map((p) => `${p.id}:${p.state}`), ...(c.reason ? { reason: c.reason } : {}) })),
      tyreSpeed: { status: tyre?.status ?? "not run", demandBasis: tyre?.outputs?.demandBasis?.value ?? null, failures: tyre?.failures || [], margins: (tyre?.margins || []).map((m) => ({ check: m.check, demandKmh: r1(m.demand * 3.6), establishedKmh: r1(m.capacity * 3.6), pass: m.utilization <= 1, ...(m.reason ? { reason: m.reason } : {}) })) },
      topSpeed: {
        mph: r1(claim.mph), kmh: r1(claim.value * 3.6), status: claim.status, basis: claim.basis,
        limitedBy: claim.limitedBy,
        unlimitedMph: r1(claim.unlimitedMph), unlimitedKmh: r1(claim.unlimitedMph * 1.609344), unlimitedStatus: claim.unlimitedStatus,
        speedLimiter: claim.speedLimiter,
        dragLimitedMph: r1(claim.dragLimitedMph), gearLimitedMph: r1(claim.gearLimitedMph),
        ...(claim.gearLimitedMphRange ? { gearLimitedMphRange: { low: r1(claim.gearLimitedMphRange.low), high: r1(claim.gearLimitedMphRange.high), rpm: claim.gearLimitedMphRange.rpm } } : {}),
        gearLimitStatus: claim.gearLimitStatus, revLimit: claim.revLimit,
        finalDrive: gear?.inputs?.finalDrive ?? null, topGearRatio: gear?.inputs?.gearRatios?.value?.at(-1) ?? null,
        warnings: gear?.warnings || [],
        unverifiedDependencies: claim.unverifiedDependencies,
      },
      tyreOptions: report_tyreOptions,
      requirements: s.graph.requirements.map((r) => ({ id: r.id, label: r.label, status: s.result(`requirement.check@${r.id}`)?.status })),
      components,
    },
  };
}
