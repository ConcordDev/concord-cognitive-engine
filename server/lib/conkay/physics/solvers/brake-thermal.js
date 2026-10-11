// server/lib/conkay/physics/solvers/brake-thermal.js
//
// thermal.brake-stop: one stop from the car's top-speed requirement, on the
// brake node's props.brakeThermal (added by thermal/brake-stop.js
// withBrakeThermal). Bulk (lumped) rotor temperature rise and the transient
// friction-face temperature from 1D conduction (thermal/conduction.js,
// benchmarked in tests/conkay-heat-transfer.test.js), a mesh-halving check,
// and the spread over every estimated input's range.
//
// Checks: peak face temperature below the iron's solidus (a sourced physical
// bound, not a fade or service limit: Wilwood publishes no thermal rating, so
// no service limit is checked and the run says so). The properties are
// room-temperature values: when the temperature rises more than 100 K above
// the property reference the result is flagged (constant-property validity),
// and the run is not a PASS.

import { registerSolver } from "../registry.js";
import { solve1D, CONDUCTION_VERSION } from "../../thermal/conduction.js";
import { BRAKE_SCREEN_VERSION } from "../../thermal/brake-stop.js";

const G0 = 9.80665;
const PROPERTY_SPAN_K = 100;

/** One stop. All inputs SI (temperatures in C). */
export function brakeStop({ massKg, v0, decel, frontShare, rotorsOnAxle, heatShare, rotor, padHeight, mat, T0, n = 120, steps = 1500 }) {
  const Ro = rotor.outerRadiusM, Ri = Ro - padHeight;
  const Aring = Math.PI * (Ro * Ro - Ri * Ri);
  const tEq = rotor.massKg / (mat.densityKgM3 * Aring);
  const ts = v0 / decel;
  const energyRotor = (0.5 * massKg * v0 * v0 * frontShare * heatShare) / rotorsOnAxle;
  const bulkRise = energyRotor / (rotor.massKg * mat.specificHeatJkgK);
  const P0 = (frontShare * heatShare * massKg * decel * v0) / rotorsOnAxle;
  const q = (t) => (t < ts ? (P0 * (1 - t / ts)) / (2 * Aring) : 0);
  const record = Array.from({ length: 300 }, (_, i) => ((i + 1) / 300) * ts);
  const r = solve1D({
    L: tEq / 2, n, k: mat.conductivityWmK, rho: mat.densityKgM3, cp: mat.specificHeatJkgK,
    left: { type: "q", q }, right: { type: "adiabatic" }, transient: { tEnd: ts, dt: ts / steps, T0, record },
  });
  let peak = -Infinity, tPeak = 0;
  for (const h of r.history) if (h.T[0] > peak) { peak = h.T[0]; tPeak = h.t; }
  const meanEnd = r.T.reduce((s, v, i) => s + v * (i === 0 || i === n ? 0.5 : 1), 0) / n;
  return { ts, Aring, tEq, energyRotor, bulkRise, P0, peakFaceC: peak, tPeak, midplaneEndC: r.T[n], meanEndC: meanEnd, penetrationM: Math.sqrt((mat.conductivityWmK / (mat.densityKgM3 * mat.specificHeatJkgK)) * ts) };
}

export const brakeThermal = registerSolver({
  id: "thermal.brake-stop",
  version: "1.0.0",
  domain: "thermal.conduction",
  domains: ["thermal.conduction", "thermal.brake"],
  fidelity: 2,
  method: "single stop from the top-speed requirement at constant deceleration; lumped rotor energy balance + transient 1D finite-volume conduction (Crank-Nicolson) through a solid-equivalent friction ring heated on both faces; mesh-halving check; one-at-a-time spread over estimated inputs",
  reference: "server/lib/conkay/thermal/brake-stop.js; conduction benchmarks in tests/conkay-heat-transfer.test.js (Incropera 7th ed.)",
  regime: "Fourier conduction, constant room-temperature properties (flagged beyond +100 K), no convection or radiation during the stop (conservative for the stop), vented rotor as a solid plate of equal mass over the friction ring, translational kinetic energy only",
  units: { inputs: "kg, m/s, m/s^2, m, W/m K, J/kg K", outputs: "C, K, J, W, s" },
  tolerance: "conduction core reproduces Incropera closed forms (semi-infinite flux surface temperature to 0.1 %); mesh-halving change reported per run",
  screening: true,
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.brakeThermal).map((n) => n.id),
  run(ctx, id) {
    const bt = ctx.get(id, "props.brakeThermal");
    const massRun = ctx.result("mass.assembly", bt.vehicle);
    const massKg = massRun?.outputs?.grossMass?.value;
    if (!Number.isFinite(massKg)) return { notComputed: `no gross mass from mass.assembly@${bt.vehicle} (${massRun?.reason || massRun?.status || "missing"})` };
    const req = ctx.requirement(bt.stopFromRequirement);
    const v0 = req?.min?.si ?? req?.min?.value;
    if (!Number.isFinite(v0)) return { notComputed: `requirement ${bt.stopFromRequirement} has no minimum speed` };
    const est = bt.estimates, mat = bt.material, rotor = bt.rotor;
    const base = {
      massKg, v0, decel: est.decelerationG.value * G0, frontShare: est.frontShare.value, rotorsOnAxle: bt.rotorsOnAxle,
      heatShare: est.rotorHeatShare.value, rotor, padHeight: est.padRadialHeightM.value, mat, T0: est.initialTempC.value,
    };
    if (!(base.padHeight < rotor.outerRadiusM)) return { notComputed: "pad radial height exceeds the rotor radius" };
    const nominal = brakeStop(base);
    const fine = brakeStop({ ...base, n: 240, steps: 3000 });
    const meshChange = Math.abs(fine.peakFaceC - nominal.peakFaceC) / Math.max(fine.peakFaceC - base.T0, 1e-9);
    // spread: each estimate at its range ends, others nominal
    const spread = {};
    const vary = { decelerationG: (v) => ({ decel: v * G0 }), frontShare: (v) => ({ frontShare: v }), padRadialHeightM: (v) => ({ padHeight: v }) };
    let lo = nominal.peakFaceC, hi = nominal.peakFaceC;
    for (const [key, set] of Object.entries(vary)) {
      const [a, b] = est[key].range;
      const ra = brakeStop({ ...base, ...set(a) }), rb = brakeStop({ ...base, ...set(b) });
      spread[key] = { range: [a, b], peakFaceC: [ra.peakFaceC, rb.peakFaceC], bulkRiseK: [ra.bulkRise, rb.bulkRise] };
      lo = Math.min(lo, ra.peakFaceC, rb.peakFaceC); hi = Math.max(hi, ra.peakFaceC, rb.peakFaceC);
    }
    const warnings = [];
    const flags = [];
    const span = nominal.peakFaceC - mat.referenceTempC;
    if (span > PROPERTY_SPAN_K) flags.push(`peak face ${nominal.peakFaceC.toFixed(0)} C is ${span.toFixed(0)} K above the property reference (${mat.referenceTempC} C): k and cp of grey iron vary with temperature and only room-temperature values are sourced; constant-property result outside its validity range`);
    if (meshChange > 0.01) flags.push(`mesh halving changes the peak rise by ${(meshChange * 100).toFixed(2)} % (> 1 %)`);
    warnings.push(...flags, "no service temperature limit checked: Wilwood publishes no thermal rating for the kit (the only bound checked is the iron's solidus)");
    const margins = [{ check: "peak friction-face temperature < solidus of the iron (physical bound, not a service limit)", demand: hi, capacity: mat.solidusC, unit: "C" }];
    return {
      inputs: {
        grossMass: { value: massKg, unit: "kg", source: massRun.runId },
        stopFrom: { value: v0, unit: "m/s", source: `requirement ${bt.stopFromRequirement}` },
        rotorMass: { value: rotor.massKg, unit: "kg", state: "sourced", source: rotor.massSource.url },
        rotorOuterRadius: { value: rotor.outerRadiusM, unit: "m", state: "sourced", source: rotor.dimensionsSource.url },
        rotorWidth: { value: rotor.widthM, unit: "m", state: "sourced", source: rotor.dimensionsSource.url },
        material: { value: { k: mat.conductivityWmK, cp: mat.specificHeatJkgK, rho: mat.densityKgM3, solidusC: mat.solidusC }, state: mat.state, basis: mat.basis, source: mat.source.url },
        ...Object.fromEntries(Object.entries(est).map(([k, v]) => [k, { value: v.value, range: v.range, state: v.state, basis: v.basis }])),
      },
      outputs: {
        stopTime: { value: nominal.ts, unit: "s" },
        energyPerRotor: { value: nominal.energyRotor, unit: "J" },
        peakPowerPerRotor: { value: nominal.P0, unit: "W" },
        bulkRise: { value: nominal.bulkRise, unit: "K", basis: "computed: energy / (rotor mass × cp)" },
        peakFaceTemp: { value: nominal.peakFaceC, unit: "C", at: nominal.tPeak, range: [lo, hi], basis: "computed: transient 1D conduction; range over the estimated inputs (one at a time)" },
        midplaneTempAtStop: { value: nominal.midplaneEndC, unit: "C" },
        frictionRingArea: { value: nominal.Aring, unit: "m^2", basis: "computed from the sourced outer radius and the estimated pad height" },
        equivalentThickness: { value: nominal.tEq, unit: "m", basis: `computed: rotor mass / (rho × ring area); the rotor is ${rotor.construction || "vented"} and its cheek thickness is not published` },
        thermalPenetrationDepth: { value: nominal.penetrationM, unit: "m", note: "sqrt(alpha × stop time): compare with the half-thickness to judge the solid-plate idealisation" },
        meshChange: { value: meshChange, unit: "1", note: "relative change of the peak rise when the mesh and time step are halved" },
        spread: { value: spread },
        validity: { value: { inRange: flags.length === 0, flags } },
      },
      margins, warnings,
      assumptions: [
        `Solver core: conduction ${CONDUCTION_VERSION}, brake screen ${BRAKE_SCREEN_VERSION}.`,
        "One stop from the top-speed requirement to rest at constant deceleration; translational kinetic energy only (wheel and driveline rotational energy not added).",
        "No convection or radiation during the stop (conservative for the stop itself); no repeated-stop heat build-up.",
        "Vented rotor modelled as a solid plate of the same mass over the friction ring, heated equally on both faces.",
      ],
    };
  },
});
