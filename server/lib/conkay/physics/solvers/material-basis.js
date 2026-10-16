// server/lib/conkay/physics/solvers/material-basis.js
//
// material.basis-discriminator on a formulated Material node: what the mass and
// the volume reading each predict for a moulded batch (density, ash residue), and
// which measurement tells them apart. It never picks a basis.

import { registerSolver } from "../registry.js";
import { formulated } from "./material-stiffness.js";
import { discriminateBasis, CAO_FROM_CACO3, ATOMIC_WEIGHTS } from "../../knowledge/basis-discrimination.js";

export const basisDiscriminator = registerSolver({
  id: "material.basis-discriminator",
  version: "1.0.0",
  domain: "material.composition",
  fidelity: 1,
  method: "Exact extremes over the composition polytope (vertex enumeration) and the density box (corner enumeration): rule-of-mixtures density (no voids) and ash residue under each basis",
  reference: "server/lib/conkay/knowledge/basis-discrimination.js",
  regime: "void-free compound; ash residue brackets CaCO3 decomposition (0.5603–1 retained) and graphene burn-off (0–1); basalt and silica assumed fully retained",
  units: { inputs: "% (each basis), kg/m3", outputs: "kg/m3, % (mass of compound)" },
  tolerance: "exact for the model over the stated ranges and cited density intervals",
  screening: true,
  targets: formulated,
  run(ctx, id) {
    const ir = ctx.get(id, "props.formulation");
    if (!ir?.constituents?.length) return { notComputed: "no formulation" };
    const d = discriminateBasis(ir.constituents);
    if (d.mass.residue.infeasible) return { notComputed: "the composition ranges cannot sum to 100 % (material.composition-check)" };
    const name = (i) => ir.constituents[i].id;
    const fmt = (b) => (b.computed ? { low: b.low, high: b.high } : { notComputed: `no cited density for: ${b.missing.map(name).join(", ")}` });
    const decide = [];
    if (d.separation.residue.decides) decide.push(`ash residue (ASTM D5630 / ASTM E1131) separates the readings regardless of voids: mass ${d.mass.residue.low.toFixed(2)}–${d.mass.residue.high.toFixed(2)} % vs volume ${d.volume.residue.low.toFixed(2)}–${d.volume.residue.high.toFixed(2)} %`);
    if (d.separation.density.decides) decide.push(`density (ASTM D792) separates them if voids are below ${(100 * d.separation.density.voidFractionToBlur).toFixed(2)} %`);
    const warnings = [
      `basis as stated: ${ir.basis}${ir.basisNote ? ` (${ir.basisNote})` : ""}. This check predicts; it does not choose a basis`,
      ...(decide.length ? [] : ["no measurement here separates the two readings over the stated ranges"]),
    ];
    return {
      inputs: { basisStated: { value: ir.basis }, atomicWeights: { value: ATOMIC_WEIGHTS.source }, caoFromCaco3: { value: CAO_FROM_CACO3, basis: "computed" } },
      outputs: {
        mass: { value: { density: fmt(d.mass.density), residue: fmt(d.mass.residue) }, unit: "kg/m3; % of compound mass" },
        volume: { value: { density: fmt(d.volume.density), residue: fmt(d.volume.residue) }, unit: "kg/m3; % of compound mass" },
        separation: { value: d.separation },
        decidingTests: { value: decide.length ? decide : null },
        retention: { value: d.retention },
      },
      warnings,
      assumptions: ["no voids in the density prediction", "basalt and silica keep their full mass on ashing (loss on ignition not read)"],
    };
  },
});
