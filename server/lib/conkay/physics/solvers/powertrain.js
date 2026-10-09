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
// tire.speed-rating: each tyre's established speed (ISO 4000-1 / ETRTO
// speed symbol, from the cited table in the component library) against the
// REQUIRED top speed (a hard failure when below) and against the model's
// top speed (a model output, unvalidated). "(Y)" and "ZR" count above 300 /
// 240 km/h only with the manufacturer's explicit rating
// (props.tireMaxSpeedKmh + props.tireMaxSpeedSource).
//
// tire.load-index: each tyre's static load (its axle's load shared by the
// tyres on that axle) against its load index capacity (cited table).

import { registerSolver } from "../registry.js";
import { speedSymbolTable, tyreSpeedCapability, loadIndexKg, loadLibrary } from "../../components/index.js";

const RPM = (2 * Math.PI) / 60; // rad/s per rpm
const KMH = 1 / 3.6;

// Speed symbol → maximum speed (km/h), from the cited reference table.
export const SPEED_SYMBOLS = Object.freeze({ ...speedSymbolTable().table });
const cite = (key) => loadLibrary().references[key].sources.map((s) => `${s.title} <${s.url}> (retrieved ${s.retrieved})`).join("; ");

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
  version: "2.0.0",
  domain: "safety.tire-speed",
  fidelity: 0,
  method: "tyre established speed (ISO 4000-1 speed symbol) ≥ required top speed (hard) and ≥ model top speed",
  reference: `Speed symbols (km/h): ${Object.entries(SPEED_SYMBOLS).map(([k, v]) => `${k} ${v}`).join(", ")}; (Y) over 300 only with the manufacturer's explicit rating. Sources: ${cite("speedSymbols")}`,
  targets: (g) => vehicles(g).filter((id) => [...g.nodes.values()].some((n) => n.props?.speedRating != null)),
  run(ctx, id) {
    const tires = contained(ctx, id, (c) => c.props?.speedRating != null);
    const covers = [id, ...tires.map((t) => t.id)];
    if (!tires.length) return { notComputed: "no tyre with props.speedRating in this vehicle" };
    const req = ctx.graph.requirements.find((r) => r.of.solver === "vehicle.top-speed" && r.of.target === id && r.min);
    const vReq = req ? ctx.requirement(req.id)?.min?.si : null;
    const gear = ctx.result("vehicle.gearing", id);
    const ts = ctx.result("vehicle.top-speed", id);
    const vmax = gear?.outputs?.effectiveTopSpeed?.value ?? ts?.outputs?.topSpeed?.value;
    const source = Number.isFinite(gear?.outputs?.effectiveTopSpeed?.value) ? gear.runId : ts?.runId;
    if (!Number.isFinite(vmax) && !Number.isFinite(vReq)) return { notComputed: "neither a required top speed nor the vehicle's top speed is known", covers };
    const margins = [];
    const failures = [];
    const inputs = {};
    if (Number.isFinite(vReq)) inputs.requiredTopSpeed = { value: vReq, unit: "m/s", source: req.id };
    if (Number.isFinite(vmax)) inputs.modelTopSpeed = { value: vmax, unit: "m/s", source, status: "model_output_unvalidated" };
    const perTyre = {};
    for (const t of tires) {
      const cap = tyreSpeedCapability(ctx.get(t.id, "props.speedRating"), {
        explicitMaxKmh: ctx.get(t.id, "props.tireMaxSpeedKmh"),
        explicitSource: ctx.get(t.id, "props.tireMaxSpeedSource"),
      });
      if (cap.error) return { notComputed: `${t.id}: ${cap.error}`, covers };
      const capMs = cap.kmh * KMH;
      inputs[`${t.id}.speedRating`] = { value: cap.symbol, note: `${cap.kmh} km/h established`, basis: cap.basis };
      perTyre[t.id] = { symbol: cap.symbol, establishedKmh: cap.kmh, basis: cap.basis };
      if (Number.isFinite(vReq)) {
        margins.push({ check: `${t.id} established speed ≥ required top speed`, demand: vReq, capacity: capMs, unit: "m/s", hard: true });
        if (capMs < vReq) failures.push(`${t.id}: ${cap.symbol} is established for ${cap.kmh} km/h (${(cap.kmh / 1.609344).toFixed(0)} mph), below the required ${(vReq * 3.6).toFixed(0)} km/h (${(vReq / 0.44704).toFixed(0)} mph)`);
      }
      if (Number.isFinite(vmax)) {
        margins.push({ check: `${t.id} established speed ≥ model top speed (model output, unvalidated)`, demand: vmax, capacity: capMs, unit: "m/s" });
      }
    }
    return {
      inputs,
      outputs: { tires: { value: tires.length }, establishedSpeeds: { value: perTyre } },
      margins,
      failures,
      covers,
    };
  },
});

export const tireLoad = registerSolver({
  id: "tire.load-index",
  version: "1.0.0",
  domain: "safety.tire-load",
  fidelity: 0,
  method: "static load per tyre = axle load / tyres on that axle ≤ load-index capacity (ISO 4000-1 table)",
  reference: `Load index table (kg per tyre). Sources: ${cite("loadIndex")}`,
  targets: (g) => vehicles(g).filter((id) => [...g.nodes.values()].some((n) => n.props?.loadIndex != null)),
  run(ctx, id) {
    const tires = contained(ctx, id, (c) => c.props?.loadIndex != null);
    const covers = [id, ...tires.map((t) => t.id)];
    const axles = ctx.result("vehicle.axle-loads", id);
    if (!axles || axles.status === "NOT_COMPUTED") return { notComputed: `no axle loads (${axles?.reason || "missing"})`, covers };
    const fx = ctx.get(id, "props.vehicle.frontAxleX");
    const rx = ctx.get(id, "props.vehicle.rearAxleX");
    const placed = [];
    for (const t of tires) {
      const pos = ctx.get(t.id, "position");
      if (!pos) return { notComputed: `${t.id} has no position, so its axle is unknown`, covers };
      placed.push({ t, axle: Math.abs(pos.x - fx) <= Math.abs(pos.x - rx) ? "front" : "rear" });
    }
    const count = { front: placed.filter((p) => p.axle === "front").length, rear: placed.filter((p) => p.axle === "rear").length };
    const load = { front: axles.outputs.frontAxleLoad.value, rear: axles.outputs.rearAxleLoad.value };
    const margins = [];
    const inputs = { frontAxleLoad: { value: load.front, unit: "N", source: axles.runId }, rearAxleLoad: { value: load.rear, unit: "N", source: axles.runId } };
    for (const { t, axle } of placed) {
      const li = ctx.get(t.id, "props.loadIndex");
      const kg = loadIndexKg(li);
      if (kg == null) return { notComputed: `${t.id}: load index ${li} is not in the reference table`, covers };
      inputs[`${t.id}.loadIndex`] = { value: li, note: `${kg} kg` };
      margins.push({ check: `${t.id} (${axle}) static load ≤ load index ${li}`, demand: load[axle] / count[axle], capacity: kg * 9.80665, unit: "N" });
    }
    return {
      inputs,
      outputs: { tires: { value: tires.length } },
      margins,
      covers,
      assumptions: ["Static, level: no aero downforce or lift, no load transfer under braking or cornering. Load index capacity is at the tyre's reference pressure."],
    };
  },
});
