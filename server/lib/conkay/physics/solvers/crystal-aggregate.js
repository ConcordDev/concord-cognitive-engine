// server/lib/conkay/physics/solvers/crystal-aggregate.js
//
// material.crystal-aggregate on any node with props.crystal:
//   { stiffnessGPa: 6×6 (Voigt notation) | trigonal: { C11, C12, C13, C14, C33, C44 },
//     conductivity: { kPara, kPerp }, expansion: { alphaPara, alphaPerp }, source }
// Isotropic properties of a random powder of that crystal — for any mineral filler.

import { registerSolver } from "../registry.js";
import { voigtReussHill, trigonalStiffness, uniaxialConductivityBounds, uniaxialCteAverage } from "../../knowledge/crystal-elasticity.js";

const crystals = (g) => [...g.nodes.values()].filter((n) => n.props?.crystal).map((n) => n.id);

export const crystalAggregate = registerSolver({
  id: "material.crystal-aggregate",
  version: "1.0.0",
  domain: "material.stiffness",
  fidelity: 1,
  method: "Voigt–Reuss–Hill averages of a single-crystal stiffness matrix; Wiener bounds and the orientation average for a uniaxial crystal's conductivity and expansion",
  reference: "server/lib/conkay/knowledge/crystal-elasticity.js",
  regime: "a random, untextured, fully dense aggregate of one crystal phase; grain boundaries, porosity and texture are not modelled",
  units: { inputs: "GPa, W/(m·K), 1/K", outputs: "GPa, 1, W/(m·K), 1/K" },
  tolerance: "exact bounds for the model; the expansion average ignores grain interaction (estimate)",
  screening: true,
  targets: crystals,
  run(ctx, id) {
    const c = ctx.get(id, "props.crystal");
    if (!c?.source) return { notComputed: "props.crystal.source is required (where the single-crystal data come from)" };
    let C;
    try {
      C = c.stiffnessGPa ? c.stiffnessGPa : c.trigonal ? trigonalStiffness(c.trigonal) : null;
    } catch (e) { return { notComputed: e.message }; }
    const outputs = {};
    const warnings = [];
    if (C) {
      let v;
      try { v = voigtReussHill(C); } catch (e) { return { notComputed: e.message }; }
      if (!v.stable) return { notComputed: v.reason };
      outputs.elastic = { value: v, unit: "GPa (K, G, E); 1 (nu)", basis: "computed: Voigt upper, Reuss lower, Hill mean" };
    } else warnings.push("no stiffness: elastic averages not computed");
    if (c.conductivity) outputs.conductivity = { value: uniaxialConductivityBounds(c.conductivity), unit: "W/(m·K)", basis: "computed: random-aggregate bounds" };
    else warnings.push("no conductivity: not computed");
    if (c.expansion) {
      outputs.expansion = { value: uniaxialCteAverage(c.expansion), unit: "1/K", basis: "estimated: orientation average without grain interaction" };
      warnings.push("the expansion average ignores the elastic interaction between grains");
    } else warnings.push("no expansion: not computed");
    return { inputs: { source: { value: c.source } }, outputs, warnings };
  },
});
