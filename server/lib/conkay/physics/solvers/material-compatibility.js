// server/lib/conkay/physics/solvers/material-compatibility.js
//
// Blend D brief item 7: material.chemical-compatibility — the sourced
// compatibility rows for a Material node's constituents. Static evidence, no
// computation: a constituent with no row is listed as not covered.

import { registerSolver } from "../registry.js";
import { setup, formulated } from "./material-stiffness.js";
import { compatibilityFor } from "../../knowledge/chemical-compatibility.js";

export const chemicalCompatibility = registerSolver({
  id: "material.chemical-compatibility",
  version: "1.0.0",
  domain: "material.compatibility",
  fidelity: 0,
  method: "Lookup of sourced constituent-level compatibility statements (PPI TR-19, Li 2023, Lavoie 2021, PubChem/CAMEO); unknown where no source was read",
  reference: "server/lib/conkay/knowledge/chemical-compatibility.js",
  regime: "constituent-level statements for the stated environments; not the compound",
  units: { inputs: "—", outputs: "—" },
  tolerance: "qualitative: the sources' own wording",
  screening: true,
  targets: formulated,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const c = compatibilityFor(s.ir);
    const unknownRows = c.rows.filter((r) => r.rating === "unknown").map((r) => `${r.id}: ${r.notes[0]}`);
    return {
      outputs: { rows: { value: c.rows }, notCovered: { value: c.notCovered }, compoundNote: { value: c.compoundNote } },
      warnings: [c.compoundNote, ...unknownRows, ...(c.notCovered.length ? [`no compatibility rows for: ${c.notCovered.join(", ")}`] : [])],
    };
  },
});
