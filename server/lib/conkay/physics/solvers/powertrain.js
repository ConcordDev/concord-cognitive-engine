// server/lib/conkay/physics/solvers/powertrain.js
//
// Gearing and tyres for a vehicle (an Assembly with props.vehicle).
//
// vehicle.gearing: road speed in each gear at the rev limit,
//   v = ω_limit · r_tyre / (gear ratio · final drive)
// The rev limit is the lower of the engine's redline and the transmission's
// maximum rated input speed (when the design states one). The gear-limited
// top speed is the fastest speed any gear reaches at the rev limit; the
// drag-limited (power-limited) speed comes from vehicle.top-speed. The
// effective top speed is the lower of the two, labelled with which one
// limits it, and it is still a model output. When the redline is an
// estimate with a range, the gear limit is given across the range too. It
// also gives the overall top-gear ratio that would put peak power exactly at
// the power-limited top speed.
//
// tire.speed-rating: each tyre's established speed (ISO 4000-1 / ETRTO
// speed symbol, from the cited table in the component library) against the
// REQUIRED top speed (a hard failure when below) and against the model's
// top speed (a model output, unvalidated). When the design has an
// electronic speed limiter (a design choice) that caps the top speed, the
// second check is against the limited speed instead, and against the set
// point plus the limiter's design overshoot allowance; the receipt names the
// limiter as the reason and keeps the unlimited model output. "(Y)" and "ZR"
// count above 300 / 240 km/h only with the manufacturer's explicit rating
// (props.tireMaxSpeedKmh + props.tireMaxSpeedSource).
//
// tire.load-index: each tyre's static load (its axle's load shared by the
// tyres on that axle) against its load index capacity (cited table).

import { registerSolver } from "../registry.js";
import { speedSymbolTable, tyreSpeedCapability, loadIndexKg, loadLibrary } from "../../components/index.js";
import { TOP_SPEED_CLAIM_STATUS as TOP_SPEED_STATUS, gearLimitedSpeed } from "./vehicle.js";

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

export const GEAR_LIMIT_STATUS = Object.freeze({ GEAR_LIMITED: "gear_limited", NOT_GEAR_LIMITED: "not_gear_limited" });

export const gearing = registerSolver({
  id: "vehicle.gearing",
  version: "1.1.0",
  domain: "performance.gearing",
  fidelity: 0,
  method: "v = ω_limit·r / (ratio·final drive) per gear, ω_limit = min(engine redline, transmission max input rpm); effective top speed = min(drag-limited, gear-limited)",
  targets: (g) => vehicles(g).filter((id) => Array.isArray(g.node(id).props.vehicle.gearRatios)),
  run(ctx, id) {
    const gl = gearLimitedSpeed(ctx, id);
    if (gl.missing) return { notComputed: gl.missing };
    const peak = ctx.get(gl.engine, "props.peakPowerRpm");
    const ts = ctx.result("vehicle.top-speed", id);
    const powerLimited = ts?.outputs?.dragLimitedTopSpeed?.value ?? ts?.outputs?.topSpeed?.value;
    const outputs = {
      revLimitRpm: { value: gl.revLimitRpm, source: gl.limitSource },
      redlineSpeedTopGear: { value: gl.perGear.at(-1).speedAtRedline, unit: "m/s" },
      gearLimitedTopSpeed: { value: gl.value, unit: "m/s", note: `fastest speed any gear reaches at ${gl.revLimitRpm} rpm` },
      speedsAtRedline: { value: gl.perGear },
      ...(gl.range ? { gearLimitedTopSpeedRange: { value: gl.range, unit: "m/s", note: "gear limit across the redline's estimated range" } } : {}),
    };
    const warnings = [];
    if (Number.isFinite(powerLimited)) {
      const geared = gl.value < powerLimited;
      outputs.dragLimitedTopSpeed = { value: powerLimited, unit: "m/s", status: TOP_SPEED_STATUS };
      outputs.effectiveTopSpeed = { value: Math.min(gl.value, powerLimited), unit: "m/s", status: TOP_SPEED_STATUS, note: "the lower of the drag-limited and gear-limited top speeds" };
      outputs.limitedBy = { value: geared ? "redline in top gear" : "power" };
      outputs.gearLimitStatus = { value: geared ? GEAR_LIMIT_STATUS.GEAR_LIMITED : GEAR_LIMIT_STATUS.NOT_GEAR_LIMITED };
      if (geared) warnings.push(`Top gear runs out of revs at ${(gl.value / 0.44704).toFixed(0)} mph, below the ${(powerLimited / 0.44704).toFixed(0)} mph the power allows: the top speed is gear-limited.`);
      if (gl.range && (gl.range.low < powerLimited) !== geared) warnings.push(`Whether the top speed is gear-limited depends on the estimated redline: ${gl.range.rpm.low} rpm gives ${(gl.range.low / 0.44704).toFixed(0)} mph, ${gl.range.rpm.high} rpm gives ${(gl.range.high / 0.44704).toFixed(0)} mph, against ${(powerLimited / 0.44704).toFixed(0)} mph drag-limited.`);
      if (Number.isFinite(peak) && peak > 0) {
        outputs.topGearOverallForPeakPower = { value: (peak * RPM * gl.r) / powerLimited, unit: "1", note: "ratio × final drive that puts peak power at the power-limited top speed" };
      }
    }
    return {
      inputs: {
        gearRatios: { value: gl.ratios }, finalDrive: { value: gl.finalDrive, source: ctx.get(id, "props.vehicle.finalDriveSource") || "given in the design" }, tireRadius: { value: gl.r, unit: "m" },
        redlineRpm: { value: gl.redline, source: gl.engine, basis: gl.redlineBasis }, ...(gl.box ? { transmissionMaxInputRpm: { value: gl.box.rpm, source: gl.box.id } } : {}),
        ...(Number.isFinite(peak) ? { peakPowerRpm: { value: peak, source: gl.engine } } : {}),
        ...(Number.isFinite(powerLimited) ? { powerLimitedTopSpeed: { value: powerLimited, unit: "m/s", source: ts.runId } } : {}),
      },
      outputs,
      warnings,
      assumptions: [
        "No tyre growth or slip at speed; r is the dynamic rolling radius.",
        "The drag-limited speed assumes peak power is available at that speed; the engine speed it implies in the chosen gear is not checked against the power curve.",
      ],
    };
  },
});

export const tireRating = registerSolver({
  id: "tire.speed-rating",
  version: "2.1.0",
  domain: "safety.tire-speed",
  fidelity: 0,
  method: "tyre established speed (ISO 4000-1 speed symbol) ≥ required top speed (hard) and ≥ the vehicle's top speed: the model output, or the speed limiter's set point (and set point + overshoot allowance) when a limiter caps it",
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
    // vehicle.top-speed already takes the lower of drag- and gear-limited,
    // capped by the speed limiter when the design has one.
    const vmax = ts?.outputs?.topSpeed?.value ?? gear?.outputs?.effectiveTopSpeed?.value;
    const source = Number.isFinite(ts?.outputs?.topSpeed?.value) ? ts.runId : gear?.runId;
    const lim = ts?.outputs?.speedLimiter?.value;
    const limited = lim?.binding === true;
    if (!Number.isFinite(vmax) && !Number.isFinite(vReq)) return { notComputed: "neither a required top speed nor the vehicle's top speed is known", covers };
    const margins = [];
    const failures = [];
    const inputs = {};
    if (Number.isFinite(vReq)) inputs.requiredTopSpeed = { value: vReq, unit: "m/s", source: req.id };
    if (Number.isFinite(vmax) && !limited) inputs.modelTopSpeed = { value: vmax, unit: "m/s", source, status: "model_output_unvalidated" };
    if (limited) {
      inputs.limitedTopSpeed = { value: vmax, unit: "m/s", source, basis: "speed limiter set point (design choice)" };
      inputs.speedLimiter = { value: lim.setKmh, unit: "km/h", overshootAllowanceKmh: lim.overshootAllowanceKmh, basis: lim.basis, status: "design_choice_unverified", source };
      inputs.unlimitedModelTopSpeed = { value: ts.outputs.unlimitedTopSpeed.value, unit: "m/s", source, status: "model_output_unvalidated", note: "not the tyre's demand while the limiter caps the speed" };
    }
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
      if (Number.isFinite(vmax) && !limited) {
        margins.push({ check: `${t.id} established speed ≥ model top speed (model output, unvalidated)`, demand: vmax, capacity: capMs, unit: "m/s", basis: "model output" });
      }
      if (limited) {
        margins.push({ check: `${t.id} established speed ≥ limited top speed (speed limiter set at ${lim.setKmh} km/h, design choice)`, demand: vmax, capacity: capMs, unit: "m/s", basis: "speed limiter set point", reason: "speed limiter (design choice) caps the top speed" });
        if (Number.isFinite(lim.overshootAllowanceKmh)) {
          margins.push({ check: `${t.id} established speed ≥ limiter set point + overshoot allowance (${lim.setKmh} + ${lim.overshootAllowanceKmh} km/h)`, demand: (lim.setKmh + lim.overshootAllowanceKmh) * KMH, capacity: cap.kmh * KMH, unit: "m/s", basis: "speed limiter set point + design overshoot allowance", reason: "speed limiter (design choice) caps the top speed" });
        }
      }
    }
    return {
      inputs,
      outputs: {
        tires: { value: tires.length }, establishedSpeeds: { value: perTyre },
        demandBasis: { value: limited ? "speed limiter (design choice)" : Number.isFinite(vmax) ? "model top speed (model output, unvalidated)" : "required top speed only" },
      },
      ...(limited ? { assumptions: [`The vehicle's top speed is the speed limiter's ${lim.setKmh} km/h set point, a design choice whose calibration and overshoot are not verified; without it the model gives ${(ts.outputs.unlimitedTopSpeed.value * 3.6).toFixed(0)} km/h.`] } : {}),
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
