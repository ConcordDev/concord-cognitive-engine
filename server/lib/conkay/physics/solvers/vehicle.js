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
    const m = massEnv?.outputs?.mass?.value;
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
        mass: { value: m, unit: "kg", source: massEnv.runId },
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
