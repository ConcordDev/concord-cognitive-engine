// server/lib/conkay/physics/solvers/powertrain.js
//
// Gearing and tyres for a vehicle (an Assembly with props.vehicle).
//
// vehicle.gearing: road speed in each gear at the engine's redline,
//   v = ω_redline · r_tyre / (gear ratio · final drive)
// The effective top speed is the lower of the power-limited speed
// (vehicle.top-speed) and the speed at redline in top gear, and the receipt
// says which one limits. It also gives the overall top-gear ratio that would
// put peak power exactly at the power-limited top speed.
//
// tire.speed-rating: each tyre's speed symbol (ISO 4000-1 / ETRTO table)
// against the vehicle's effective top speed.

import { registerSolver } from "../registry.js";

const RPM = (2 * Math.PI) / 60; // rad/s per rpm
const KMH = 1 / 3.6;

// Speed symbol → maximum speed (km/h).
export const SPEED_SYMBOLS = { L: 120, M: 130, N: 140, P: 150, Q: 160, R: 170, S: 180, T: 190, U: 200, H: 210, V: 240, W: 270, Y: 300 };

function contained(ctx, id, test, seen = new Set()) {
  const out = [];
  for (const c of ctx.children(id, "CONTAINS")) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (test(c)) out.push(c);
    if (c.kind === "Assembly") out.push(...contained(ctx, c.id, test, seen));
  }
  return out;
}

const vehicles = (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.vehicle).map((n) => n.id);

export const gearing = registerSolver({
  id: "vehicle.gearing",
  version: "1.0.0",
  domain: "performance.gearing",
  fidelity: 0,
  method: "v = ω_redline·r / (ratio·final drive) per gear; effective top speed = min(power-limited, redline in top gear)",
  targets: (g) => vehicles(g).filter((id) => Array.isArray(g.node(id).props.vehicle.gearRatios)),
  run(ctx, id) {
    const ratios = ctx.get(id, "props.vehicle.gearRatios");
    const finalDrive = ctx.get(id, "props.vehicle.finalDrive");
    const r = ctx.get(id, "props.vehicle.tireRadius");
    if (!Array.isArray(ratios) || !ratios.length || !ratios.every((x) => Number.isFinite(x) && x > 0)) return { notComputed: "gearRatios must be positive numbers" };
    if (!(Number.isFinite(finalDrive) && finalDrive > 0)) return { notComputed: "props.vehicle.finalDrive required" };
    if (!(Number.isFinite(r) && r > 0)) return { notComputed: "props.vehicle.tireRadius required" };
    const engines = contained(ctx, id, (c) => c.kind === "Actuator");
    if (engines.length !== 1) return { notComputed: `gearing needs exactly one engine or motor (found ${engines.length})` };
    const e = engines[0].id;
    const redline = ctx.get(e, "props.redlineRpm");
    const peak = ctx.get(e, "props.peakPowerRpm");
    if (!(Number.isFinite(redline) && redline > 0)) return { notComputed: `${e} needs props.redlineRpm` };
    const perGear = ratios.map((g, i) => ({ gear: i + 1, ratio: g, speedAtRedline: (redline * RPM * r) / (g * finalDrive) }));
    const top = perGear.at(-1).speedAtRedline;
    const ts = ctx.result("vehicle.top-speed", id);
    const powerLimited = ts?.outputs?.topSpeed?.value;
    const outputs = {
      redlineSpeedTopGear: { value: top, unit: "m/s" },
      speedsAtRedline: { value: perGear },
    };
    const warnings = [];
    if (Number.isFinite(powerLimited)) {
      const limitedBy = top < powerLimited ? "redline in top gear" : "power";
      outputs.effectiveTopSpeed = { value: Math.min(top, powerLimited), unit: "m/s" };
      outputs.limitedBy = { value: limitedBy };
      if (limitedBy !== "power") warnings.push(`Top gear runs out of revs at ${(top / 0.44704).toFixed(0)} mph, below the ${(powerLimited / 0.44704).toFixed(0)} mph the power allows.`);
      if (Number.isFinite(peak) && peak > 0) {
        outputs.topGearOverallForPeakPower = { value: (peak * RPM * r) / powerLimited, unit: "1", note: "ratio × final drive that puts peak power at the power-limited top speed" };
      }
    }
    return {
      inputs: {
        gearRatios: { value: ratios }, finalDrive: { value: finalDrive }, tireRadius: { value: r, unit: "m" },
        redlineRpm: { value: redline, source: e }, ...(Number.isFinite(peak) ? { peakPowerRpm: { value: peak, source: e } } : {}),
        ...(Number.isFinite(powerLimited) ? { powerLimitedTopSpeed: { value: powerLimited, unit: "m/s", source: ts.runId } } : {}),
      },
      outputs,
      warnings,
      assumptions: ["No tyre growth or slip at speed; r is the dynamic rolling radius."],
    };
  },
});

export const tireRating = registerSolver({
  id: "tire.speed-rating",
  version: "1.0.0",
  domain: "safety.tire-speed",
  fidelity: 0,
  method: "tyre speed symbol (ISO 4000-1 table) ≥ vehicle effective top speed",
  reference: "Speed symbols: Q 160, R 170, S 180, T 190, U 200, H 210, V 240, W 270, Y 300 km/h",
  targets: (g) => vehicles(g).filter((id) => [...g.nodes.values()].some((n) => n.props?.speedRating != null)),
  run(ctx, id) {
    const tires = contained(ctx, id, (c) => c.props?.speedRating != null);
    if (!tires.length) return { notComputed: "no tyre with props.speedRating in this vehicle" };
    const gear = ctx.result("vehicle.gearing", id);
    const ts = ctx.result("vehicle.top-speed", id);
    const vmax = gear?.outputs?.effectiveTopSpeed?.value ?? ts?.outputs?.topSpeed?.value;
    const source = Number.isFinite(gear?.outputs?.effectiveTopSpeed?.value) ? gear.runId : ts?.runId;
    if (!Number.isFinite(vmax)) return { notComputed: "the vehicle's top speed is not computed", covers: [id, ...tires.map((t) => t.id)] };
    const margins = [];
    const inputs = { topSpeed: { value: vmax, unit: "m/s", source } };
    for (const t of tires) {
      const sym = String(ctx.get(t.id, "props.speedRating")).trim().toUpperCase();
      const kmh = SPEED_SYMBOLS[sym];
      if (!kmh) return { notComputed: `${t.id}: unknown speed symbol "${sym}"`, covers: [id, ...tires.map((x) => x.id)] };
      inputs[`${t.id}.speedRating`] = { value: sym, note: `${kmh} km/h` };
      margins.push({ check: `${t.id} rated speed ≥ top speed`, demand: vmax, capacity: kmh * KMH, unit: "m/s" });
    }
    return { inputs, outputs: { tires: { value: tires.length } }, margins, covers: [id, ...tires.map((t) => t.id)] };
  },
});
