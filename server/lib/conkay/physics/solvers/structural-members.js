// server/lib/conkay/physics/solvers/structural-members.js
//
// Registry adapters over Concord's existing structural compute. Nothing here
// re-derives the math: beam.fea runs the beam-frame direct-stiffness solver
// through lib/conkay/beam-study.js (the same path the ConKay workspace uses),
// and beam.euler-buckling calls lib/compute/engineering-compute.js
// columnBuckling, converting SI in and out.

import { registerSolver } from "../registry.js";
import { runFEA } from "../../../simulation/fea-solver.js";
import { buildBeamStudy, summarizeBeamStudy, BEAM_SUPPORTS } from "../../beam-study.js";
import { columnBuckling, sectionProperties } from "../../../compute/engineering-compute.js";

const MPA = 1e6;
const KIP = 4448.2216152605;
const PSI = 6894.757293168;
const IN = 0.0254;
const FT = 0.3048;

const beamTargets = (load) => (g) => g.nodesOfKind("Beam")
  .filter((n) => n.geometry?.shape === "i-beam" && g.loadsOn(n.id).some((l) => Number.isFinite(l[load])))
  .map((n) => n.id);

function beamInputs(ctx, id) {
  const g = ctx.get(id, "geometry");
  const support = ctx.get(id, "props.support");
  const mat = ctx.material(id);
  return { g, support, mat };
}

export const beamFea = registerSolver({
  id: "beam.fea",
  version: "1.0.0",
  domain: "structural.bending",
  domains: ["structural.bending", "structural.deflection"],
  fidelity: 2,
  method: "beam-frame direct-stiffness FEA (fea-solver via conkay/beam-study), checked against the closed-form hand calculation",
  targets: beamTargets("pointLoad"),
  run(ctx, id) {
    const { g, support, mat } = beamInputs(ctx, id);
    if (!BEAM_SUPPORTS.includes(support)) return { notComputed: `props.support must be one of ${BEAM_SUPPORTS.join(", ")}` };
    if (!mat || mat.youngsModulusPa == null || mat.yieldPa == null) return { notComputed: "material needs E and yield strength" };
    const loads = ctx.loadsOn(id).filter((l) => Number.isFinite(l.pointLoad));
    const mm = (v) => v * 1000;
    const dims = { length: mm(g.length), height: mm(g.height), flangeWidth: mm(g.flangeWidth), flangeThickness: mm(g.flangeThickness), webThickness: mm(g.webThickness) };
    const material = { E: mat.youngsModulusPa / MPA, yield: mat.yieldPa / MPA };
    const margins = [];
    const warnings = [];
    let worst = null;
    for (const l of loads) {
      const study = buildBeamStudy({ dims, material, support, loadN: l.pointLoad });
      if (!study.ok) return { notComputed: study.error };
      const fea = runFEA(study.model);
      if (!fea.ok) return { notComputed: fea.error || "FEA solve failed" };
      const sum = summarizeBeamStudy(study, fea, material);
      margins.push({ check: `max bending stress ≤ yield (${l.loadCase})`, demand: sum.maxStressMPa * MPA, capacity: mat.yieldPa, unit: "Pa" });
      if (!sum.handCheck.agrees) warnings.push(`${l.loadCase}: FEA and hand calculation differ by more than ${sum.handCheck.tolerance * 100}%`);
      for (const w of sum.warnings) warnings.push(`${l.loadCase}: ${w}`);
      if (!worst || sum.maxStressMPa > worst.sum.maxStressMPa) worst = { l, sum, receipt: study.analysisReceipt };
    }
    return {
      inputs: {
        support: { value: support },
        ...Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, { value: v / 1000, unit: "m" }])),
        E: { value: mat.youngsModulusPa, unit: "Pa", source: mat.source },
        yield: { value: mat.yieldPa, unit: "Pa", source: mat.source },
        ...Object.fromEntries(loads.map((l) => [`pointLoad.${l.loadCase}`, { value: l.pointLoad, unit: "N" }])),
      },
      outputs: {
        maxStress: { value: worst.sum.maxStressMPa * MPA, unit: "Pa" },
        maxDeflection: { value: worst.sum.maxDeflectionMm / 1000, unit: "m" },
        handCheckStress: { value: worst.sum.handCheck.maxStressMPa * MPA, unit: "Pa" },
        handCheckDeflection: { value: worst.sum.handCheck.maxDeflectionMm / 1000, unit: "m" },
        governingLoadCase: { value: worst.l.loadCase },
      },
      margins,
      warnings,
      assumptions: [
        `Point load at ${support === "cantilever" ? "the free tip" : "midspan"}.`,
        "Euler-Bernoulli, linear-static, small deflection; self-weight not included.",
      ],
      receipt: worst.receipt,
    };
  },
});

// AISC Commentary Table C-A-7.1, recommended design K for ideal end conditions.
const K_BY_SUPPORT = { "simply-supported": 1.0, fixed: 0.65, cantilever: 2.1 };

export const beamBuckling = registerSolver({
  id: "beam.euler-buckling",
  version: "1.0.0",
  domain: "structural.buckling",
  fidelity: 1,
  method: "Euler critical load Pcr = π²·E·I_min/(K·L)² via engineering-compute columnBuckling",
  reference: "K from AISC 360-16 Commentary Table C-A-7.1 (recommended design values)",
  targets: beamTargets("compression"),
  run(ctx, id) {
    const { g, support, mat } = beamInputs(ctx, id);
    const kGiven = ctx.get(id, "props.kFactor");
    const K = Number.isFinite(kGiven) ? kGiven : K_BY_SUPPORT[support];
    if (!Number.isFinite(K)) return { notComputed: "needs props.kFactor or a known props.support" };
    if (!mat || mat.youngsModulusPa == null) return { notComputed: "material needs E" };
    const sec = sectionProperties("i-beam", { flangeWidth: g.flangeWidth, height: g.height, flangeThickness: g.flangeThickness, webThickness: g.webThickness });
    const Imin = Math.min(sec.Ix, sec.Iy);
    const loads = ctx.loadsOn(id).filter((l) => Number.isFinite(l.compression));
    const margins = [];
    let pcrN = null;
    for (const l of loads) {
      const r = columnBuckling({ loadKips: l.compression / KIP, lengthFt: g.length / FT, modulusE: mat.youngsModulusPa / PSI, momentI: Imin / IN ** 4, kFactor: K });
      if (r.error) return { notComputed: r.error };
      pcrN = r.value * KIP;
      margins.push({ check: `axial load ≤ Euler critical load (${l.loadCase})`, demand: l.compression, capacity: pcrN, unit: "N" });
    }
    const warnings = [];
    const rGyr = Math.sqrt(Imin / sec.area);
    const slenderness = (K * g.length) / rGyr;
    if (mat.yieldPa != null) {
      const limit = 4.71 * Math.sqrt(mat.youngsModulusPa / mat.yieldPa);
      if (slenderness < limit) warnings.push(`KL/r = ${slenderness.toFixed(0)} is below 4.71·√(E/Fy) = ${limit.toFixed(0)}: the column buckles inelastically and Euler overestimates its capacity. AISC E3 flexural buckling is needed.`);
    }
    return {
      inputs: {
        K: { value: K, source: Number.isFinite(kGiven) ? "props.kFactor" : `AISC C-A-7.1 for ${support}` },
        length: { value: g.length, unit: "m" },
        Imin: { value: Imin, unit: "m4" },
        E: { value: mat.youngsModulusPa, unit: "Pa", source: mat.source },
        ...Object.fromEntries(loads.map((l) => [`compression.${l.loadCase}`, { value: l.compression, unit: "N" }])),
      },
      outputs: { criticalLoad: { value: pcrN, unit: "N" }, slenderness: { value: slenderness } },
      margins,
      warnings,
      assumptions: ["Ideal straight column, concentric load, elastic buckling about the weak axis.", "No safety factor applied: compare with your required factor."],
    };
  },
});

// Chassis screen: each Beam with props.role "rail" in a vehicle, simply
// supported between the axles, carrying its share of the gross weight times
// a vertical load factor as one point load at midspan. A point load at
// midspan gives twice the peak moment of the same weight spread evenly, so
// this is conservative for a ladder frame. Screening, not a frame FEA of the
// whole structure.
const DEFAULT_CHASSIS_LOAD_FACTOR = 2.0;

function railsIn(ctx, id, seen = new Set()) {
  const out = [];
  for (const c of ctx.children(id, "CONTAINS")) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (c.kind === "Beam" && ctx.get(c.id, "props.role") === "rail") out.push(c);
    if (c.kind === "Assembly") out.push(...railsIn(ctx, c.id, seen));
  }
  return out;
}

export const chassisScreen = registerSolver({
  id: "vehicle.chassis-screen",
  version: "1.0.0",
  domain: "structural.chassis",
  fidelity: 2,
  method: "each rail: beam-frame FEA, simply supported over the wheelbase, point load (gross weight × load factor / rails) at midspan",
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.vehicle).map((n) => n.id)
    .filter((id) => [...g.nodes.values()].some((n) => n.kind === "Beam" && n.props?.role === "rail")),
  run(ctx, id) {
    const rails = railsIn(ctx, id);
    if (!rails.length) return { notComputed: "no Beam with props.role \"rail\" in this vehicle" };
    const fx = ctx.get(id, "props.vehicle.frontAxleX");
    const rx = ctx.get(id, "props.vehicle.rearAxleX");
    if (!Number.isFinite(fx) || !Number.isFinite(rx) || !(rx > fx)) return { notComputed: "props.vehicle needs frontAxleX < rearAxleX" };
    const massEnv = ctx.result("mass.assembly", id);
    const m = massEnv?.outputs?.grossMass?.value ?? massEnv?.outputs?.mass?.value;
    if (!Number.isFinite(m)) return { notComputed: `no mass for ${id} (${massEnv?.reason || "missing"})` };
    const given = ctx.get(id, "props.vehicle.chassisLoadFactor");
    const factor = Number.isFinite(given) && given > 0 ? given : DEFAULT_CHASSIS_LOAD_FACTOR;
    const span = rx - fx;
    const P = (m * 9.80665 * factor) / rails.length;
    const margins = [];
    const outputs = {};
    const inputs = {
      grossMass: { value: m, unit: "kg", source: massEnv.runId },
      loadFactor: { value: factor, source: Number.isFinite(given) ? "props.vehicle.chassisLoadFactor" : "default 2 g vertical (assumption)" },
      span: { value: span, unit: "m", source: "wheelbase" },
      loadPerRail: { value: P, unit: "N" },
    };
    for (const r of rails) {
      const g = ctx.get(r.id, "geometry");
      const mat = ctx.material(r.id);
      if (g?.shape !== "i-beam") return { notComputed: `${r.id}: only i-beam rails are screened` };
      if (!mat || mat.youngsModulusPa == null || mat.yieldPa == null) return { notComputed: `${r.id}: material needs E and yield` };
      const mm = (x) => x * 1000;
      const study = buildBeamStudy({
        dims: { length: mm(span), height: mm(g.height), flangeWidth: mm(g.flangeWidth), flangeThickness: mm(g.flangeThickness), webThickness: mm(g.webThickness) },
        material: { E: mat.youngsModulusPa / MPA, yield: mat.yieldPa / MPA }, support: "simply-supported", loadN: P,
      });
      if (!study.ok) return { notComputed: `${r.id}: ${study.error}` };
      const fea = runFEA(study.model);
      if (!fea.ok) return { notComputed: `${r.id}: ${fea.error || "FEA failed"}` };
      const sum = summarizeBeamStudy(study, fea, { E: mat.youngsModulusPa / MPA, yield: mat.yieldPa / MPA });
      margins.push({ check: `${r.id} bending stress ≤ yield`, demand: sum.maxStressMPa * MPA, capacity: mat.yieldPa, unit: "Pa" });
      outputs[`${r.id}.maxStress`] = { value: sum.maxStressMPa * MPA, unit: "Pa" };
      outputs[`${r.id}.maxDeflection`] = { value: sum.maxDeflectionMm / 1000, unit: "m" };
      inputs[`${r.id}.material`] = { value: mat.id, source: mat.source };
    }
    return {
      inputs, outputs, margins,
      assumptions: [
        "Each rail simply supported at the axles with the whole share of weight at midspan (conservative for a distributed load).",
        "Vertical bending only: torsion, crash loads and joints are not screened.",
      ],
      covers: [id, ...rails.map((r) => r.id)],
    };
  },
});
