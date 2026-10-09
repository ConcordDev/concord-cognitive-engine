// server/lib/conkay/physics/solvers/vehicle.js
//
// Road-load and top speed for a vehicle: an Assembly with props.vehicle.
// Top speed is where the power reaching the wheels equals the road load:
//
//   P·η = ½·ρ·Cd·A·v³ + Crr·m·g·v
//
// Mass comes from the assembly's mass roll-up and power from the Actuators
// it contains (props.maxPower, W), so editing a part or swapping an engine
// reruns this. Cd and A are inputs labelled with their source: there is no
// Cd-from-geometry solver yet, so a drag coefficient is never presented as
// computed.

import { registerSolver } from "../registry.js";

const G = 9.80665;
const ISA_SEA_LEVEL_RHO = 1.225; // kg/m³, ISA 15 °C at sea level

function contained(ctx, id, kind, seen = new Set()) {
  const out = [];
  for (const c of ctx.children(id, "CONTAINS")) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (c.kind === kind) out.push(c);
    if (c.kind === "Assembly") out.push(...contained(ctx, c.id, kind, seen));
  }
  return out;
}

// Frontal area: given in the design, or computed from the body named by
// props.vehicle.frontalAreaFrom when that body is an ellipsoid shell
// (exact for an ellipsoid: π·W·H/4; a real body differs, so screening).
function frontalArea(ctx, id) {
  const from = ctx.get(id, "props.vehicle.frontalAreaFrom");
  if (typeof from === "string" && from) {
    const g = ctx.get(from, "geometry");
    if (!g) return { error: `frontalAreaFrom: ${from} has no geometry` };
    if (g.shape !== "ellipsoid-shell") return { error: `frontalAreaFrom: ${from} is a ${g.shape}; only an ellipsoid-shell body gives a frontal area` };
    return { value: (Math.PI * g.width * g.height) / 4, source: `computed from ${from} (ellipsoid π·W·H/4; screening)` };
  }
  const a = ctx.get(id, "props.vehicle.frontalArea");
  if (Number.isFinite(a) && a > 0) return { value: a, source: ctx.get(id, "props.vehicle.frontalAreaSource") || "given in the design" };
  return { error: null };
}

// A top speed from this model is a model output, not a validated claim:
// it holds only as far as each of these is shown to hold. The acceptance
// check reports which of them the design has evidence for.
export const TOP_SPEED_CLAIM_STATUS = "model_output_unvalidated";
export const TOP_SPEED_UNVERIFIED_DEPENDENCIES = [
  { id: "drag_model", what: "Cd and frontal area: Cd is an input (no CFD or wind-tunnel value); frontal area is given or from an ellipsoid body (screening)" },
  { id: "drivetrain_losses", what: "driveline efficiency is an input, not measured or computed from the gearbox and differential" },
  { id: "gearing", what: "the gear limit needs the gear ratios, final drive, tyre radius and a redline; the redline and the power available at that engine speed are inputs (vehicle.gearing)" },
  { id: "tyre_limits", what: "tyre speed rating and load index against this speed and the axle loads (tire.speed-rating, tire.load-index)" },
  { id: "stability", what: "high-speed stability and aero lift: no solver yet" },
  { id: "thermal", what: "cooling capacity for sustained full power: no solver yet" },
];

const RPM = (2 * Math.PI) / 60; // rad/s per rpm

/**
 * The gear-limited speed: the fastest any gear reaches at the rev limit,
 *   v = ω_limit · r_tyre / (gear ratio · final drive),
 * ω_limit = min(engine redline, transmission max rated input speed when the
 * design states one). Returns { value, revLimitRpm, limitSource, perGear,
 * range? } or { missing: reason } when the design lacks a piece.
 */
export function gearLimitedSpeed(ctx, id) {
  const ratios = ctx.get(id, "props.vehicle.gearRatios");
  if (!Array.isArray(ratios)) return { missing: "no props.vehicle.gearRatios" };
  if (!ratios.length || !ratios.every((x) => Number.isFinite(x) && x > 0)) return { missing: "gearRatios must be positive numbers" };
  const finalDrive = ctx.get(id, "props.vehicle.finalDrive");
  if (!(Number.isFinite(finalDrive) && finalDrive > 0)) return { missing: "props.vehicle.finalDrive required" };
  const r = ctx.get(id, "props.vehicle.tireRadius");
  if (!(Number.isFinite(r) && r > 0)) return { missing: "props.vehicle.tireRadius required" };
  const engines = contained(ctx, id, "Actuator");
  if (engines.length !== 1) return { missing: `gearing needs exactly one engine or motor (found ${engines.length})` };
  const e = engines[0].id;
  const redline = ctx.get(e, "props.redlineRpm");
  if (!(Number.isFinite(redline) && redline > 0)) return { missing: `${e} needs props.redlineRpm` };
  const redlineBasis = ctx.get(e, "props.redlineBasis") || "given in the design";
  const boxes = containedWhere(ctx, id, (c) => Number.isFinite(c.props?.maxInputRpm)).map((b) => ({ id: b.id, rpm: ctx.get(b.id, "props.maxInputRpm") }));
  const box = boxes.sort((x, y) => x.rpm - y.rpm)[0] || null;
  const capped = (rpm) => (box && box.rpm < rpm ? box.rpm : rpm);
  const limit = capped(redline);
  const speedAt = (rpm) => Math.max(...ratios.map((g) => (rpm * RPM * r) / (g * finalDrive)));
  const out = {
    value: speedAt(limit), revLimitRpm: limit,
    limitSource: box && box.rpm < redline ? `${box.id} max input speed` : `${e} redline (${redlineBasis})`,
    perGear: ratios.map((g, i) => ({ gear: i + 1, ratio: g, speedAtRedline: (limit * RPM * r) / (g * finalDrive) })),
    engine: e, redline, redlineBasis, box, finalDrive, ratios, r,
  };
  const range = ctx.get(e, "props.redlineRange");
  if (range && Number.isFinite(range.low) && Number.isFinite(range.high)) {
    out.range = { low: speedAt(capped(range.low)), high: speedAt(capped(range.high)), rpm: { low: capped(range.low), high: capped(range.high) } };
  }
  return out;
}

function containedWhere(ctx, id, test, seen = new Set()) {
  const out = [];
  for (const c of ctx.children(id, "CONTAINS")) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (test(c)) out.push(c);
    if (c.kind === "Assembly") out.push(...containedWhere(ctx, c.id, test, seen));
  }
  return out;
}

/** v where P·η = a·v³ + b·v; the left side is fixed, the right is increasing in v. */
export function solveTopSpeed(wheelPowerW, a, b) {
  let lo = 0;
  let hi = 1;
  while (a * hi ** 3 + b * hi < wheelPowerW) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (a * mid ** 3 + b * mid < wheelPowerW) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export const vehicleTopSpeed = registerSolver({
  id: "vehicle.top-speed",
  version: "1.2.0",
  domain: "performance.top-speed",
  fidelity: 1,
  method: "steady state: P·η = ½ρ·Cd·A·v³ + Crr·m·g·v, solved for v by bisection; then min(that, speed at the rev limit in the tallest gear) when the gearing is known",
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.vehicle).map((n) => n.id),
  run(ctx, id) {
    // Read only the keys used, so moving an axle doesn't rerun top speed.
    const v = Object.fromEntries(["dragCoefficient", "rollingResistance", "drivelineEfficiency", "airDensity", "dragCoefficientSource"]
      .map((k) => [k, ctx.get(id, `props.vehicle.${k}`)]));
    const fa = frontalArea(ctx, id);
    if (fa.error) return { notComputed: fa.error };
    v.frontalArea = fa.value;
    v.frontalAreaSource = fa.source;
    const missing = ["dragCoefficient", "frontalArea", "rollingResistance", "drivelineEfficiency"].filter((k) => !(Number.isFinite(v[k]) && v[k] > 0));
    if (missing.length) return { notComputed: `props.vehicle needs ${missing.join(", ")}` };
    if (v.drivelineEfficiency > 1) return { notComputed: "drivelineEfficiency must be at most 1" };
    const massEnv = ctx.result("mass.assembly", id);
    // Gross mass: the vehicle plus its payload (occupants, cargo).
    const m = massEnv?.outputs?.grossMass?.value ?? massEnv?.outputs?.mass?.value;
    if (!Number.isFinite(m)) return { notComputed: `no mass for ${id} (${massEnv?.reason || "mass roll-up missing"})` };
    const engines = contained(ctx, id, "Actuator");
    const powers = engines.map((e) => ({ id: e.id, w: ctx.get(e.id, "props.maxPower") }));
    const bad = powers.filter((p) => !(Number.isFinite(p.w) && p.w > 0));
    if (!engines.length) return { notComputed: "no Actuator (engine or motor) in this vehicle" };
    if (bad.length) return { notComputed: `props.maxPower (W) missing on ${bad.map((p) => p.id).join(", ")}` };
    const P = powers.reduce((s, p) => s + p.w, 0);
    const rho = Number.isFinite(v.airDensity) ? v.airDensity : ISA_SEA_LEVEL_RHO;
    const a = 0.5 * rho * v.dragCoefficient * v.frontalArea;
    const b = v.rollingResistance * m * G;
    const vDrag = solveTopSpeed(P * v.drivelineEfficiency, a, b);
    // The model's top speed is the lower of the drag-limited speed and,
    // when the gearing is known, the gear-limited speed.
    const gl = gearLimitedSpeed(ctx, id);
    const geared = Number.isFinite(gl.value) && gl.value < vDrag;
    const vmax = geared ? gl.value : vDrag;
    const limitedBy = !Number.isFinite(gl.value) ? `drag (power-limited); gear limit not computed: ${gl.missing}` : geared ? "gear (rev limit in top gear)" : "drag (power-limited)";
    return {
      inputs: {
        mass: { value: m, unit: "kg", source: `${massEnv.runId} (gross: kerb + payload)` },
        power: { value: P, unit: "W", source: powers.map((p) => p.id).join(" + ") },
        dragCoefficient: { value: v.dragCoefficient, source: v.dragCoefficientSource || "given in the design (not computed from geometry)" },
        frontalArea: { value: v.frontalArea, unit: "m2", source: v.frontalAreaSource },
        rollingResistance: { value: v.rollingResistance, source: "given in the design" },
        drivelineEfficiency: { value: v.drivelineEfficiency, source: "given in the design" },
        airDensity: { value: rho, unit: "kg/m3", source: Number.isFinite(v.airDensity) ? "given in the design" : "ISA sea level, 15 °C" },
      },
      outputs: {
        topSpeed: { value: vmax, unit: "m/s", status: TOP_SPEED_CLAIM_STATUS, limitedBy, unverifiedDependencies: TOP_SPEED_UNVERIFIED_DEPENDENCIES.map((d) => d.id) },
        dragLimitedTopSpeed: { value: vDrag, unit: "m/s", status: TOP_SPEED_CLAIM_STATUS },
        ...(Number.isFinite(gl.value) ? { gearLimitedTopSpeed: { value: gl.value, unit: "m/s", status: TOP_SPEED_CLAIM_STATUS, note: `fastest speed any gear reaches at ${gl.revLimitRpm} rpm (${gl.limitSource})` } } : {}),
        limitedBy: { value: limitedBy },
        claimStatus: { value: TOP_SPEED_CLAIM_STATUS, note: "a model output, not a validated top speed", unverifiedDependencies: TOP_SPEED_UNVERIFIED_DEPENDENCIES },
        aeroPowerAtTopSpeed: { value: a * vmax ** 3, unit: "W" },
        rollingPowerAtTopSpeed: { value: b * vmax, unit: "W" },
      },
      assumptions: [
        "Steady, level road, no wind; the lower of the power-limited speed and, when the gearing is known, the speed at the rev limit in the tallest gear.",
        "Cd and frontal area are inputs; aero is screening until a CFD or wind-tunnel value replaces them.",
        `Model output (${TOP_SPEED_CLAIM_STATUS}): depends on ${TOP_SPEED_UNVERIFIED_DEPENDENCIES.map((d) => d.id).join(", ")}.`,
      ],
    };
  },
});

// Power the engine must deliver to hold the speed a requirement asks for:
//   P = (½ρ·Cd·A·v³ + Crr·m·g·v) / η
// The target speed comes from the design's own top-speed requirement, so
// changing the requirement, the mass or the aero reruns this.
export const vehicleRequiredPower = registerSolver({
  id: "vehicle.required-power",
  version: "1.0.0",
  domain: "performance.power-sizing",
  fidelity: 1,
  method: "P = (½ρ·Cd·A·v³ + Crr·m·g·v)/η at the required top speed",
  targets: (g) => g.nodesOfKind("Assembly")
    .filter((n) => n.props?.vehicle && g.requirements.some((r) => r.of.solver === "vehicle.top-speed" && r.of.target === n.id && r.min))
    .map((n) => n.id),
  run(ctx, id) {
    const req = ctx.graph.requirements.find((r) => r.of.solver === "vehicle.top-speed" && r.of.target === id && r.min);
    const vReq = ctx.requirement(req.id)?.min?.si;
    if (!Number.isFinite(vReq)) return { notComputed: "no top-speed requirement" };
    const v = Object.fromEntries(["dragCoefficient", "rollingResistance", "drivelineEfficiency", "airDensity"]
      .map((k) => [k, ctx.get(id, `props.vehicle.${k}`)]));
    const fa = frontalArea(ctx, id);
    if (fa.error) return { notComputed: fa.error };
    v.frontalArea = fa.value;
    const missing = ["dragCoefficient", "frontalArea", "rollingResistance", "drivelineEfficiency"].filter((k) => !(Number.isFinite(v[k]) && v[k] > 0));
    if (missing.length) return { notComputed: `props.vehicle needs ${missing.join(", ")}` };
    const massEnv = ctx.result("mass.assembly", id);
    // Gross mass: the vehicle plus its payload (occupants, cargo).
    const m = massEnv?.outputs?.grossMass?.value ?? massEnv?.outputs?.mass?.value;
    if (!Number.isFinite(m)) return { notComputed: `no mass for ${id} (${massEnv?.reason || "mass roll-up missing"})` };
    const rho = Number.isFinite(v.airDensity) ? v.airDensity : ISA_SEA_LEVEL_RHO;
    const aero = 0.5 * rho * v.dragCoefficient * v.frontalArea * vReq ** 3;
    const rolling = v.rollingResistance * m * G * vReq;
    const required = (aero + rolling) / v.drivelineEfficiency;
    const engines = contained(ctx, id, "Actuator");
    const installed = engines.map((e) => ctx.get(e.id, "props.maxPower")).filter((w) => Number.isFinite(w) && w > 0);
    const margins = installed.length === engines.length && engines.length
      ? [{ check: "installed power ≥ power to reach the required top speed", demand: required, capacity: installed.reduce((s, w) => s + w, 0), unit: "W" }]
      : [];
    return {
      inputs: {
        requiredTopSpeed: { value: vReq, unit: "m/s", source: req.id },
        mass: { value: m, unit: "kg", source: `${massEnv.runId} (gross: kerb + payload)` },
        dragCoefficient: { value: v.dragCoefficient, source: "given in the design (not computed from geometry)" },
        frontalArea: { value: v.frontalArea, unit: "m2", source: fa.source },
        rollingResistance: { value: v.rollingResistance },
        drivelineEfficiency: { value: v.drivelineEfficiency },
        airDensity: { value: rho, unit: "kg/m3", source: Number.isFinite(v.airDensity) ? "given in the design" : "ISA sea level, 15 °C" },
      },
      outputs: {
        requiredPower: { value: required, unit: "W" },
        aeroPower: { value: aero, unit: "W" },
        rollingPower: { value: rolling, unit: "W" },
      },
      margins,
      assumptions: ["Steady, level road, no wind.", engines.length ? "" : "No engine yet: this is the power to size one."].filter(Boolean),
    };
  },
});
