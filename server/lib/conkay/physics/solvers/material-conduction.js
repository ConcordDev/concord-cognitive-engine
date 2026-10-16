// server/lib/conkay/physics/solvers/material-conduction.js
//
// material.k-multiphase on a formulated Material node (any recipe, any number of constituents):
// Wiener and Hashin–Shtrikman bounds, and the random-spheroid mean-field estimate (Nan / Mori–Tanaka form).
// Each constituent's conductivity: `conductivity` (isotropic), or a platelet's in-plane / through-plane pair
// (graphene: effective multilayer to supplier in-plane, and through-plane), taken as its eigenvalue interval —
// effective conductivity rises with every local conductivity, so the bounds stay rigorous.
// Shapes for the estimate: props.micromechanics.phases.<id>.aspectRatio (or derived from a sourced thickness and
// lateral size); an interface resistance: props.micromechanics.phases.<id>.interfaceResistance { R (m²K/W), a11, a33 (m) }.

import { registerSolver } from "../registry.js";
import { setup, blocked, formulated, span } from "./material-stiffness.js";
import { wiener, hashinShtrikmanK, randomSpheroidsKBand } from "../../knowledge/multiphase-conduction.js";

/** { iso: {lo,hi} } | { k11: {lo,hi}, k33: {lo,hi} } (11 = across the symmetry axis, 33 = along it) */
function kOf(c) {
  const p = c.properties;
  if (p.conductivity) return { k11: span(p.conductivity), k33: span(p.conductivity), basis: "cited isotropic conductivity" };
  if (p.throughPlaneConductivity && (p.inPlaneConductivity || p.effectiveInPlaneConductivity)) {
    const lo = span(p.effectiveInPlaneConductivity || p.inPlaneConductivity).lo, hi = span(p.inPlaneConductivity || p.effectiveInPlaneConductivity).hi;
    return { k11: { lo, hi }, k33: span(p.throughPlaneConductivity), basis: "platelet: in-plane (effective multilayer to supplier) across the thickness axis, through-plane along it" };
  }
  return null;
}

export const kMultiphase = registerSolver({
  id: "material.k-multiphase",
  version: "1.0.0",
  domain: "material.thermal-conductivity",
  fidelity: 1,
  method: "Wiener (series/parallel) and Hashin–Shtrikman bounds for N phases at the nominal volume fractions; random-spheroid mean-field estimate (Nan's form) with optional interface resistance",
  reference: "server/lib/conkay/knowledge/multiphase-conduction.js",
  regime: "steady conduction, statistically isotropic mixture; the estimate assumes one continuous matrix (the largest fraction), non-interacting randomly oriented spheroids, no percolation; with no interface resistance given, perfect thermal contact (an overestimate for graphene)",
  units: { inputs: "W/(m·K), m²K/W, m", outputs: "W/(m·K)" },
  tolerance: "bounds exact for the inputs; the estimate is a mean-field model",
  screening: true,
  targets: formulated,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const rows = s.ir.constituents.map((c, i) => ({ id: c.id, c, phi: s.phi ? s.phi[i] : null, k: kOf(c) }));
    const missing = rows.filter((r) => !r.k).map((r) => r.id);
    if (missing.length) s.blockers.push(`no cited thermal conductivity for: ${missing.join(", ")} (any unknown phase sends the rigorous lower bound to 0)`);
    if (s.blockers.length) return blocked(s.blockers);
    const t = rows.reduce((a, r) => a + r.phi, 0);
    const eig = rows.map((r) => ({ phi: r.phi / t, k: { lo: Math.min(r.k.k11.lo, r.k.k33.lo), hi: Math.max(r.k.k11.hi, r.k.k33.hi) } }));
    const w = wiener(eig), hs = hashinShtrikmanK(eig);
    const outputs = {
      wiener: { value: w, unit: "W/(m·K)", basis: "parallel (upper) and series (lower)" },
      hashinShtrikman: { value: hs, unit: "W/(m·K)", basis: "rigorous bounds for an isotropic random mixture (each phase over its eigenvalue interval)" },
    };
    const warnings = ["the bounds are wide when one phase conducts orders of magnitude better than the rest (graphene); the estimate below narrows it under its assumptions"];
    // the estimate
    const mi = rows.reduce((b, r, i) => (r.phi > rows[b].phi ? i : b), 0);
    const shapes = { ...(s.micro.phases || {}) };
    for (const r of rows) {
      const th = span(r.c.properties.thickness), D = span(r.c.properties.lateralSize);
      if (!shapes[r.id]?.aspectRatio && th && D) shapes[r.id] = { ...(shapes[r.id] || {}), aspectRatio: { lo: th.lo / D.hi, hi: th.hi / D.lo }, source: "sourced: platelet thickness / lateral size" };
    }
    const needShape = rows.filter((_, i) => i !== mi).filter((r) => !(span(shapes[r.id]?.aspectRatio)?.lo > 0)).map((r) => r.id);
    if (needShape.length) {
      outputs.estimate = { value: null, basis: `not computed: no shape (props.micromechanics.phases.<id>.aspectRatio) for ${needShape.join(", ")}` };
    } else {
      const m = rows[mi];
      if (m.k.k11.lo !== m.k.k33.lo || m.k.k11.hi !== m.k.k33.hi) return { notComputed: `the largest phase (${m.id}) is anisotropic: the estimate needs an isotropic matrix` };
      const band = randomSpheroidsKBand(m.k.k11, rows.filter((_, i) => i !== mi).map((r) => {
        const ir = shapes[r.id].interfaceResistance;
        return { phi: r.phi / t, k11: r.k.k11, k33: r.k.k33, aspect: span(shapes[r.id].aspectRatio), ...(ir ? { R: ir.R, a11: ir.a11, a33: ir.a33 } : {}) };
      }));
      outputs.estimate = { value: { low: band.low, high: band.high, matrix: m.id }, unit: "W/(m·K)", basis: `mean-field, random spheroids; extremes over ${band.corners} interval corners` };
      const noR = rows.filter((_, i) => i !== mi).filter((r) => !shapes[r.id].interfaceResistance).map((r) => r.id);
      if (noR.length) warnings.push(`perfect thermal contact assumed for ${noR.join(", ")}: an interface resistance lowers the estimate, strongly for graphene`);
    }
    if (s.ir.basis === "unknown") warnings.push(`basis unknown (${s.ir.basisNote}): read as mass fractions`);
    return { inputs: { volumeFractions: { value: Object.fromEntries(rows.map((r) => [r.id, r.phi])) }, conductivities: { value: Object.fromEntries(rows.map((r) => [r.id, { k11: r.k.k11, k33: r.k.k33, basis: r.k.basis }])) }, shapes: { value: shapes } }, outputs, warnings };
  },
});
