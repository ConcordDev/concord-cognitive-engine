// server/lib/conkay/physics/solvers/material.js
//
// Blend D brief item 1: the knowledge layer's formulation functions as
// registered solvers on a design-graph Material node whose
// props.formulation is a material IR (knowledge/material-ir.js).
//
//   material.composition-check — the ranges against 100 % (PASS when they fix
//     it, WARN when 100 % is reachable but not fixed, FAIL when unreachable);
//   material.density-rom — rule-of-mixtures density from cited constituent
//     densities (NOT_COMPUTED, naming the constituent, when one is unknown;
//     the conditional screening estimate is kept beside it, labelled);
//   material.mass-to-volume — φ_i = (w_i/ρ_i)/Σ(w_j/ρ_j) at the nominal
//     composition with the density intervals propagated exactly.
// The receipts are the knowledge layer's own, byte for byte.

import { registerSolver } from "../registry.js";
import { validateMaterialIr, compositionCheck, strictDensity, conditionalDensity, massToVolumeFractions } from "../../knowledge/material-ir.js";

const formulated = (g) => [...g.nodes.values()].filter((n) => n.kind === "Material" && n.props?.formulation).map((n) => n.id);

function irOf(ctx, id) {
  const ir = ctx.get(id, "props.formulation");
  const errors = validateMaterialIr(ir);
  return errors.length ? { notComputed: `invalid material IR: ${errors.join("; ")}` } : { ir };
}

export const materialCompositionCheck = registerSolver({
  id: "material.composition-check",
  version: "1.0.0",
  domain: "material.composition",
  fidelity: 0,
  method: "Sum of the constituent ranges against 100 % in integer units of 0.0001 % (knowledge/formulation.js checkComposition)",
  reference: "server/lib/conkay/knowledge/formulation.js",
  regime: "percentages of one basis (mass or volume); a stated total is compared, not assumed",
  units: { inputs: "% (of the stated basis)", outputs: "%" },
  tolerance: "exact (integer arithmetic at 0.0001 %)",
  screening: false,
  targets: formulated,
  run(ctx, id) {
    const q = irOf(ctx, id);
    if (q.notComputed) return q;
    const { check, receipt } = compositionCheck(q.ir);
    const failures = check.feasible ? [] : [check.note, ...(check.invertedRanges.length ? [`inverted ranges: ${check.invertedRanges.join(", ")}`] : [])];
    const warnings = check.feasible && !check.exact ? [check.note] : [];
    if (q.ir.basis === "unknown") warnings.push(`basis unknown: ${q.ir.basisNote}`);
    return {
      inputs: { constituents: { value: receipt.inputs }, statedTotalPct: { value: q.ir.statedTotal } },
      outputs: { check: { value: check }, nominal: { value: q.ir.nominal, note: q.ir.nominal ? "a proposed version by the named rule; the formulator has to confirm it" : "no version: the ranges cannot reach 100 %" } },
      failures, warnings, receipt,
    };
  },
});

export const materialDensityRom = registerSolver({
  id: "material.density-rom",
  version: "1.0.0",
  domain: "material.density",
  fidelity: 1,
  method: "Rule of mixtures: 1/ρ = Σ w_i/ρ_i (mass basis) or ρ = Σ φ_i·ρ_i (volume basis), composition ranges × cited density intervals propagated exactly by a greedy fill (knowledge/rule-of-mixtures.js)",
  reference: "server/lib/conkay/knowledge/rule-of-mixtures.js",
  regime: "additive volumes, no voids, no interphase; a real moulded part with porosity is lighter",
  units: { inputs: "% and kg/m3", outputs: "kg/m3" },
  tolerance: "the band is exact for the stated ranges and density intervals; the model error (voids, non-additive mixing) is not in it",
  screening: true,
  targets: formulated,
  run(ctx, id) {
    const q = irOf(ctx, id);
    if (q.notComputed) return q;
    const { inputs, pointPct, result } = strictDensity(q.ir);
    const basisWarn = q.ir.basis === "unknown" ? [`basis unknown (${q.ir.basisNote}): computed as mass fractions`] : [];
    if (!result.ok) {
      const cond = conditionalDensity({ inputs, missing: result.missing, pointPct });
      return {
        notComputed: `${result.receipt.reason}: the strict density is unknown`,
        outputs: {
          strict: { value: { status: "unknown", missing: result.missing, receiptId: result.receipt.id } },
          screening: {
            value: { massBasis: { ...cond.mass.range, nominal: cond.mass.value, receiptId: cond.mass.receipt.id }, volumeBasis: { ...cond.volume.range, nominal: cond.volume.value, receiptId: cond.volume.receipt.id } },
            unit: "kg/m3",
            note: "CONDITIONAL on assumptions A1–A4 (see assumptions): screening only, not a property of record",
          },
        },
        assumptions: cond.assumptions,
        warnings: basisWarn,
        receipt: { strict: result.receipt, conditional: cond.mass.receipt, conditionalVolumeBasis: cond.volume.receipt },
      };
    }
    return {
      inputs: { constituents: { value: result.receipt.inputs } },
      outputs: { density: { value: { low: result.range.min, high: result.range.max, nominal: result.value }, unit: "kg/m3", basis: "estimated (rule of mixtures, no voids)", receiptId: result.receipt.id } },
      warnings: ["estimated: rule of mixtures assumes no voids; measure the compound (ASTM D792)", ...basisWarn],
      assumptions: result.receipt.assumptions,
      receipt: result.receipt,
    };
  },
});

export const materialMassToVolume = registerSolver({
  id: "material.mass-to-volume",
  version: "1.0.0",
  domain: "material.composition",
  fidelity: 0,
  method: "φ_i = (w_i/ρ_i)/Σ_j(w_j/ρ_j) at the nominal mass fractions; exact bounds over the density box (φ_i is monotone in every ρ)",
  reference: "server/lib/conkay/knowledge/material-ir.js",
  regime: "additive volumes, no voids; mass fractions at the nominal (proposed) version, densities as cited intervals",
  units: { inputs: "% (mass) and kg/m3", outputs: "% (volume)" },
  tolerance: "exact for the inputs (floating point)",
  screening: false,
  targets: formulated,
  run(ctx, id) {
    const q = irOf(ctx, id);
    if (q.notComputed) return q;
    const ir = q.ir;
    if (ir.basis === "volume") {
      return { outputs: { volumeFractions: { value: ir.nominal?.fractions || null, note: "the source states volume fractions: nothing to convert" } }, warnings: [] };
    }
    if (!ir.nominal) return { notComputed: "no nominal composition (the ranges cannot reach 100 %)" };
    const w = ir.constituents.map((c) => ir.nominal.fractions.find((f) => f.id === c.id).pct);
    const r = massToVolumeFractions(w, ir.constituents.map((c) => c.properties.density));
    if (!r.ok) return { notComputed: `no cited density for: ${r.missing.map((i) => ir.constituents[i].id).join(", ")}` };
    return {
      inputs: { massFractionsPct: { value: Object.fromEntries(ir.constituents.map((c, i) => [c.id, w[i]])) }, densities: { value: Object.fromEntries(ir.constituents.map((c) => [c.id, c.properties.density])) } },
      outputs: { volumeFractions: { value: Object.fromEntries(ir.constituents.map((c, i) => [c.id, r.phi[i]])), unit: "% (volume)", basis: "computed: nominal at density midpoints, min/max exact over the density intervals" } },
      warnings: ir.basis === "unknown" ? [`basis unknown (${ir.basisNote}): read as mass fractions`] : [],
    };
  },
});
