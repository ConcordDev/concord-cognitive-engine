// server/lib/conkay/physics/solvers/material-stiffness.js
//
// Blend D brief item 3: stiffness and strength screening on a Material node
// with props.formulation (a material IR). Optional props.micromechanics:
//   { filler: <constituent id>, shape: "fibre" | "platelet" | "sphere",
//     aspectRatio: number | { lo, hi },            // l/d or D/t
//     interfacialShearStrengthPa, matrixStressAtFailurePa, orientationFactor,
//     fibreLengthM: number | { lo, hi } }
// Every missing input is NOT_COMPUTED with its name. Volume fractions come
// from the IR's mass fractions and cited densities (material.mass-to-volume);
// the moduli from the cited property tables (constituent-properties.js).

import { registerSolver } from "../registry.js";
import { validateMaterialIr, massToVolumeFractions } from "../../knowledge/material-ir.js";
import { voigt, reuss, halpinTsaiOriented, moriTanakaSpheres, kellyTyson } from "../../knowledge/micromechanics.js";

export const formulated = (g) => [...g.nodes.values()].filter((n) => n.kind === "Material" && n.props?.formulation).map((n) => n.id);
export const span = (v) => (v == null ? null : typeof v === "number" ? { lo: v, hi: v } : v);
export const mid = (s) => (s.lo + s.hi) / 2;
export const MORI_TANAKA_MAX_PHI = 0.3;

/**
 * The IR, the nominal volume fractions (or the reason there are none) and the micromechanics inputs. Solvers
 * collect every missing input into `blockers` and report them all at once, not just the first.
 */
export function setup(ctx, id) {
  const ir = ctx.get(id, "props.formulation");
  const errors = validateMaterialIr(ir);
  if (errors.length) return { notComputed: `invalid material IR: ${errors.join("; ")}` };
  const micro = ctx.get(id, "props.micromechanics") || {};
  if (!ir.nominal) return { notComputed: "no nominal composition (the ranges cannot reach 100 %)" };
  if (ir.basis === "volume") return { ir, phi: ir.nominal.fractions.map((f) => f.pct / 100), micro, blockers: [] };
  const w = ir.constituents.map((c) => ir.nominal.fractions.find((f) => f.id === c.id).pct);
  const r = massToVolumeFractions(w, ir.constituents.map((c) => c.properties.density));
  if (!r.ok) return { ir, phi: null, micro, blockers: [`no volume fractions: no cited density for ${r.missing.map((i) => ir.constituents[i].id).join(", ")}`] };
  return { ir, phi: r.phi.map((p) => p.pct / 100), micro, blockers: [] };
}

export const blocked = (b) => ({ notComputed: b.join("; ") });

/**
 * A constituent's modulus interval. Graphene nanoplatelets have no single modulus: the band runs from the
 * effective multilayer value (low) to the supplier in-plane value (high), and says so.
 */
export function modulusOf(c) {
  const p = c.properties;
  if (p.youngsModulus) return { ...span(p.youngsModulus), basis: "cited Young's modulus" };
  if (p.effectiveModulus && p.inPlaneModulus) return { lo: span(p.effectiveModulus).lo, hi: span(p.inPlaneModulus).hi, basis: "platelet: effective multilayer modulus (low) to the supplier in-plane modulus (high)" };
  return null;
}

function missingModuli(ir, ids) {
  return ir.constituents.filter((c) => ids.includes(c.id) && !modulusOf(c)).map((c) => c.id);
}

/** The two-phase split: the named filler and one matrix made of every other constituent (a single polymer only). */
export function twoPhase(ir, micro) {
  const filler = ir.constituents.find((c) => c.id === micro.filler);
  if (!filler) return { notComputed: `props.micromechanics.filler names no constituent (${micro.filler ?? "not set"})` };
  const others = ir.constituents.filter((c) => c.id !== filler.id);
  if (others.length !== 1) return { notComputed: `this model is two-phase (one matrix, one filler); the formulation has ${others.length} other constituents (${others.map((c) => c.id).join(", ")}): no multi-filler extension is claimed` };
  return { filler, matrix: others[0] };
}

const common = {
  units: { inputs: "Pa, m, % (mass or volume)", outputs: "Pa" },
  screening: true,
  targets: formulated,
};

export const modulusBounds = registerSolver({
  id: "material.modulus-bounds",
  version: "1.0.0",
  domain: "material.stiffness",
  fidelity: 1,
  method: "Voigt (iso-strain) and Reuss (iso-stress) bounds over every constituent at the nominal volume fractions, each modulus over its cited interval",
  reference: "server/lib/conkay/knowledge/micromechanics.js",
  regime: "any phase count and shape; the true modulus of a perfectly bonded, void-free composite lies between the bounds",
  tolerance: "exact bounds for the inputs; the band also spans the moduli intervals",
  ...common,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const ids = s.ir.constituents.map((c) => c.id);
    const missing = missingModuli(s.ir, ids);
    if (missing.length) s.blockers.push(`no cited Young's modulus for: ${missing.join(", ")}`);
    if (s.blockers.length) return blocked(s.blockers);
    const ph = (pick) => s.ir.constituents.map((c, i) => ({ phi: s.phi[i], E: pick(modulusOf(c)) }));
    const norm = (p) => { const t = p.reduce((a, x) => a + x.phi, 0); return p.map((x) => ({ ...x, phi: x.phi / t })); };
    return {
      inputs: { volumeFractions: { value: Object.fromEntries(ids.map((k, i) => [k, s.phi[i]])) } },
      outputs: {
        voigt: { value: { low: voigt(norm(ph((x) => x.lo))), high: voigt(norm(ph((x) => x.hi))) }, unit: "Pa", basis: "upper bound (iso-strain)" },
        reuss: { value: { low: reuss(norm(ph((x) => x.lo))), high: reuss(norm(ph((x) => x.hi))) }, unit: "Pa", basis: "lower bound (iso-stress)" },
      },
      warnings: ["bounds, not a prediction: a short-fibre or platelet composite lies between them, usually near Reuss at low loading"],
    };
  },
});

export const modulusHalpinTsai = registerSolver({
  id: "material.modulus-halpin-tsai",
  version: "1.0.0",
  domain: "material.stiffness",
  fidelity: 1,
  method: "Halpin–Tsai (ξ = 2·aspect along, 2 across; spheres ξ = 2), Tsai–Pagano random in plane (3/8 E11 + 5/8 E22); band over the aspect-ratio and modulus intervals, aligned to transverse",
  reference: "server/lib/conkay/knowledge/micromechanics.js",
  regime: "two phases (one matrix, one filler), perfect bond, no voids, dilute to moderate loading (φ ≤ 0.3); fibre orientation not known, so the band runs from transverse to aligned",
  tolerance: "a screening band; published HDPE/GNP data sit far below the aligned bound (Tarani et al. 2020)",
  ...common,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const tp = twoPhase(s.ir, s.micro);
    if (tp.notComputed) s.blockers.push(tp.notComputed);
    else {
      const missing = missingModuli(s.ir, [tp.filler.id, tp.matrix.id]);
      if (missing.length) s.blockers.push(`no cited Young's modulus for: ${missing.join(", ")}`);
    }
    const shape = s.micro.shape;
    if (!["fibre", "platelet", "sphere"].includes(shape)) s.blockers.push("props.micromechanics.shape must be fibre, platelet or sphere (the filler's shape is not known)");
    const aspect = shape === "sphere" ? { lo: 1, hi: 1 } : span(s.micro.aspectRatio);
    if (shape !== "sphere" && !(aspect && aspect.lo > 0)) s.blockers.push(`no aspect ratio for ${s.micro.filler ?? "the filler"} (${shape === "fibre" ? "fibre length/diameter after compounding" : "platelet diameter/thickness"}): Halpin–Tsai needs it`);
    if (s.blockers.length) return blocked(s.blockers);
    const phi = s.phi[s.ir.constituents.indexOf(tp.filler)];
    const Em = modulusOf(tp.matrix), Ef = modulusOf(tp.filler);
    const lo = halpinTsaiOriented({ Em: Em.hi, Ef: Ef.lo, phi, aspect: aspect.lo });
    const hi = halpinTsaiOriented({ Em: Em.lo, Ef: Ef.hi, phi, aspect: aspect.hi });
    const nominal = halpinTsaiOriented({ Em: mid(Em), Ef: mid(Ef), phi, aspect: mid(aspect) });
    const warnings = [];
    if (phi > MORI_TANAKA_MAX_PHI) warnings.push(`φ = ${phi.toFixed(3)} is above the declared ${MORI_TANAKA_MAX_PHI} range: out of range, flagged`);
    warnings.push("perfect bond assumed; a poorly coupled filler sits below the band");
    return {
      inputs: { filler: { value: tp.filler.id }, phi: { value: phi }, aspectRatio: { value: aspect }, shape: { value: shape }, fillerModulus: { value: { lo: Ef.lo, hi: Ef.hi }, basis: Ef.basis }, matrixModulus: { value: { lo: Em.lo, hi: Em.hi }, basis: Em.basis } },
      outputs: {
        modulus: {
          value: { transverseLow: Math.min(lo.E22, hi.E22), alignedHigh: Math.max(lo.E11, hi.E11), randomInPlaneNominal: shape === "sphere" ? nominal.E22 : nominal.randomInPlane },
          unit: "Pa", basis: "screening band (matrix and filler moduli and aspect ratio over their intervals)",
        },
      },
      warnings,
    };
  },
});

export const modulusMoriTanaka = registerSolver({
  id: "material.modulus-mori-tanaka",
  version: "1.0.0",
  domain: "material.stiffness",
  fidelity: 1,
  method: "Mori–Tanaka for spherical isotropic inclusions (bulk and shear closed form)",
  reference: "server/lib/conkay/knowledge/micromechanics.js",
  regime: `spherical isotropic filler, two phases, perfect bond, φ ≤ ${MORI_TANAKA_MAX_PHI} (against random-sphere FEM it is within 9 % to 30 vol % and diverges past the packing limit: Jeon et al. 2022)`,
  tolerance: "−9 % … 0 % against random-sphere FEM to 30 vol % (Jeon et al. 2022 Table 4)",
  ...common,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const tp = twoPhase(s.ir, s.micro);
    if (tp.notComputed) s.blockers.push(tp.notComputed);
    if (s.micro.shape !== "sphere") s.blockers.push("Mori–Tanaka here is for spherical fillers only (props.micromechanics.shape = sphere); fibres and platelets use material.modulus-halpin-tsai");
    if (!tp.notComputed) {
      const missing = missingModuli(s.ir, [tp.filler.id, tp.matrix.id]);
      const noNu = [tp.filler, tp.matrix].filter((c) => !c.properties.poisson).map((c) => c.id);
      if (missing.length) s.blockers.push(`no cited Young's modulus for: ${missing.join(", ")}`);
      if (noNu.length) s.blockers.push(`no cited Poisson's ratio for: ${noNu.join(", ")}`);
    }
    if (s.blockers.length) return blocked(s.blockers);
    const phi = s.phi[s.ir.constituents.indexOf(tp.filler)];
    const m = tp.matrix.properties, f = tp.filler.properties;
    const Em = modulusOf(tp.matrix), Ef = modulusOf(tp.filler);
    const r = moriTanakaSpheres({ Em: mid(Em), num: mid(span(m.poisson)), Ef: mid(Ef), nuf: mid(span(f.poisson)), phi });
    const lo = moriTanakaSpheres({ Em: Em.lo, num: mid(span(m.poisson)), Ef: Ef.lo, nuf: mid(span(f.poisson)), phi });
    const hi = moriTanakaSpheres({ Em: Em.hi, num: mid(span(m.poisson)), Ef: Ef.hi, nuf: mid(span(f.poisson)), phi });
    const warnings = phi > MORI_TANAKA_MAX_PHI ? [`φ = ${phi.toFixed(3)} is above the declared ${MORI_TANAKA_MAX_PHI}: out of range, never PASS`] : [];
    return {
      inputs: { filler: { value: tp.filler.id }, phi: { value: phi } },
      outputs: { modulus: { value: { nominal: r.E, low: lo.E, high: hi.E }, unit: "Pa" }, poisson: { value: r.nu } },
      warnings: [...warnings, "screening: perfect bond, no voids"],
    };
  },
});

export const tensileBounds = registerSolver({
  id: "material.tensile-bounds",
  version: "1.0.0",
  domain: "material.strength",
  fidelity: 1,
  method: "Modified Kelly–Tyson: σ_c = χ1·(Σ τ·l·V/d + Σ σ_f·V·(1 − σ_f·d/(4τl))) + (1 − V_f)·σ_m*, l_c = d·σ_f/(2τ)",
  reference: "server/lib/conkay/knowledge/micromechanics.js",
  regime: "short fibres, perfect fibre strength at the stated value, interfacial shear strength τ given (not inferred), orientation factor χ1 given",
  tolerance: "a screening band over the inputs' intervals; not a test result",
  ...common,
  units: { inputs: "Pa, m", outputs: "Pa" },
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const tp = twoPhase(s.ir, s.micro);
    const need = s.blockers;
    if (tp.notComputed) need.push(tp.notComputed);
    const f = tp.notComputed ? {} : tp.filler.properties;
    if (s.micro.shape !== "fibre") need.push("props.micromechanics.shape = fibre (Kelly–Tyson is a fibre model)");
    const fid = s.micro.filler ?? "the filler";
    if (!tp.notComputed && !f.tensileStrength) need.push(`no cited tensile strength for ${fid}`);
    if (!tp.notComputed && !f.diameter) need.push(`no cited diameter for ${fid}`);
    if (!span(s.micro.fibreLengthM)) need.push(`fibre length after compounding for ${fid} (props.micromechanics.fibreLengthM)`);
    if (!(s.micro.interfacialShearStrengthPa > 0)) need.push("interfacial shear strength τ (props.micromechanics.interfacialShearStrengthPa): measured, never assumed");
    if (!(s.micro.matrixStressAtFailurePa >= 0)) need.push("matrix stress at composite failure σ_m* (props.micromechanics.matrixStressAtFailurePa)");
    if (!(s.micro.orientationFactor > 0 && s.micro.orientationFactor <= 1)) need.push("orientation factor χ1 in (0, 1] (props.micromechanics.orientationFactor)");
    if (need.length) return { notComputed: need.join("; ") };
    const phi = s.phi[s.ir.constituents.indexOf(tp.filler)];
    const L = span(s.micro.fibreLengthM), sf = span(f.tensileStrength), d = span(f.diameter);
    const run = (l, sig, dd) => kellyTyson({ fibres: [{ l, V: phi }], d: dd, sigmaF: sig, tau: s.micro.interfacialShearStrengthPa, sigmaMStar: s.micro.matrixStressAtFailurePa, chi1: s.micro.orientationFactor });
    const low = run(L.lo, sf.lo, d.hi), high = run(L.hi, sf.hi, d.lo), nom = run(mid(L), mid(sf), mid(d));
    return {
      inputs: { phi: { value: phi }, tau: { value: s.micro.interfacialShearStrengthPa, unit: "Pa" }, chi1: { value: s.micro.orientationFactor } },
      outputs: { strength: { value: { low: low.sigmaC, nominal: nom.sigmaC, high: high.sigmaC }, unit: "Pa" }, criticalLength: { value: { nominal: nom.lc }, unit: "m" } },
      warnings: ["screening: single fibre length, uniform fibre strength; tensile tests (ASTM D638) decide"],
    };
  },
});
