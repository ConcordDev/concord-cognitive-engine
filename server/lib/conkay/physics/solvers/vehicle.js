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
  version: "1.0.0",
  domain: "performance.top-speed",
  fidelity: 1,
  method: "steady state: P·η = ½ρ·Cd·A·v³ + Crr·m·g·v, solved for v by bisection",
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.vehicle).map((n) => n.id),
  run(ctx, id) {
    // Read only the keys used, so moving an axle doesn't rerun top speed.
    const v = Object.fromEntries(["dragCoefficient", "frontalArea", "rollingResistance", "drivelineEfficiency", "airDensity", "dragCoefficientSource", "frontalAreaSource"]
      .map((k) => [k, ctx.get(id, `props.vehicle.${k}`)]));
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
    const vmax = solveTopSpeed(P * v.drivelineEfficiency, a, b);
    return {
      inputs: {
        mass: { value: m, unit: "kg", source: `${massEnv.runId} (gross: kerb + payload)` },
        power: { value: P, unit: "W", source: powers.map((p) => p.id).join(" + ") },
        dragCoefficient: { value: v.dragCoefficient, source: v.dragCoefficientSource || "given in the design (not computed from geometry)" },
        frontalArea: { value: v.frontalArea, unit: "m2", source: v.frontalAreaSource || "given in the design" },
        rollingResistance: { value: v.rollingResistance, source: "given in the design" },
        drivelineEfficiency: { value: v.drivelineEfficiency, source: "given in the design" },
        airDensity: { value: rho, unit: "kg/m3", source: Number.isFinite(v.airDensity) ? "given in the design" : "ISA sea level, 15 °C" },
      },
      outputs: {
        topSpeed: { value: vmax, unit: "m/s" },
        aeroPowerAtTopSpeed: { value: a * vmax ** 3, unit: "W" },
        rollingPowerAtTopSpeed: { value: b * vmax, unit: "W" },
      },
      assumptions: [
        "Steady, level road, no wind; power-limited, not gearing- or rev-limited.",
        "Cd and frontal area are inputs; aero is screening until a CFD or wind-tunnel value replaces them.",
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
    const v = Object.fromEntries(["dragCoefficient", "frontalArea", "rollingResistance", "drivelineEfficiency", "airDensity"]
      .map((k) => [k, ctx.get(id, `props.vehicle.${k}`)]));
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
        frontalArea: { value: v.frontalArea, unit: "m2" },
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
