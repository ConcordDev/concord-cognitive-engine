// server/lib/conkay/physics/solvers/bracket-plate.js
//
// Cantilever rectangular plate, screened with the same beam-frame solver the
// workspace uses. The horizontal arm carries the point load; a vertical leg
// is geometry only. Registered from domains/conkay-design.js (not index.js)
// so openDesign, which snapshots the registry when a design is opened, sees it.

import { registerSolver } from "../registry.js";
import { runFEA } from "../../../simulation/fea-solver.js";
import { sectionProperties } from "../../../compute/engineering-compute.js";
import { screeningHand, intentToFeaModel } from "../../nlp-design-intent.js";

export const bracketPlate = registerSolver({
  id: "bracket.plate",
  version: "1.0.0",
  domain: "structural.bending",
  domains: ["structural.bending", "structural.deflection"],
  fidelity: 2,
  method: "cantilever plate screened as an Euler-Bernoulli beam (fea-solver), checked against Mc/I and PL^3/(3EI)",
  targets: (g) => g.nodesOfKind("Plate")
    .filter((n) => n.geometry?.shape === "plate" && g.loadsOn(n.id).some((l) => Number.isFinite(l.pointLoad)))
    .map((n) => n.id),
  run(ctx, id) {
    const g = ctx.get(id, "geometry");
    const mat = ctx.material(id);
    const support = ctx.get(id, "props.support") || "cantilever";
    if (!g || g.shape !== "plate") return { notComputed: "plate geometry required" };
    if (support !== "cantilever") return { notComputed: "bracket.plate screens a cantilever arm; set props.support to cantilever" };
    if (!mat || mat.youngsModulusPa == null || mat.yieldPa == null) return { notComputed: "material needs E and yield strength" };
    const loads = ctx.loadsOn(id).filter((l) => Number.isFinite(l.pointLoad) && l.pointLoad !== 0);
    if (!loads.length) return { notComputed: "pointLoad required" };
    const P = Math.abs(loads[0].pointLoad);
    const sec = sectionProperties("box", { width: g.width, height: g.thickness });
    if (!sec) return { notComputed: "section properties could not be derived from the plate" };
    const intent = {
      part: "bracket",
      spans: [g.length],
      loads: [{ location: "end", forceN: -P, direction: "Fy" }],
      material: "steel",
      support: "cantilever",
      section: {
        kind: "plate",
        width: g.width,
        thickness: g.thickness,
        length: g.length,
        area: sec.area,
        momentI: sec.Ix,
        Iy: sec.Iy,
        depthIn: g.thickness,
      },
    };
    // Material on the intent is only a label for screeningHand's table.
    // The numbers below override that table with the node's real material.
    const model = intentToFeaModel(intent);
    for (const m of model.members) {
      m.elasticModulus = mat.youngsModulusPa;
      m.allowableStress = mat.yieldPa;
    }
    const fea = runFEA(model);
    if (!fea.ok) return { notComputed: fea.error || "FEA solve failed" };
    const hand = screeningHand(intent);
    const scaleE = mat.youngsModulusPa / hand.elasticModulusPa;
    const maxStressPa = Math.max(...fea.stresses.map((s) => s.combinedStress));
    const maxDeflectionM = Math.max(...fea.displacements.map((d) => d.magnitude));
    const handStress = hand.maxStressPa;
    const handDefl = hand.maxDeflectionM / scaleE;
    const utilization = maxStressPa / mat.yieldPa;
    const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
    const warnings = [];
    if (hand.applicable && (rel(maxStressPa, handStress) > 0.05 || rel(maxDeflectionM, handDefl) > 0.05)) {
      warnings.push("FEA and the plate hand check differ by more than 5%.");
    }
    return {
      inputs: {
        length: { value: g.length, unit: "m" },
        width: { value: g.width, unit: "m" },
        thickness: { value: g.thickness, unit: "m" },
        pointLoad: { value: P, unit: "N" },
        E: { value: mat.youngsModulusPa, unit: "Pa", source: mat.source },
        yield: { value: mat.yieldPa, unit: "Pa", source: mat.source },
      },
      outputs: {
        maxStress: { value: maxStressPa, unit: "Pa" },
        maxDeflection: { value: maxDeflectionM, unit: "m" },
        handCheckStress: { value: handStress, unit: "Pa" },
        handCheckDeflection: { value: handDefl, unit: "m" },
        utilization: { value: utilization, unit: "1" },
      },
      margins: [{
        check: `bending stress ≤ yield (${loads[0].loadCase})`,
        demand: maxStressPa,
        capacity: mat.yieldPa,
        unit: "Pa",
      }],
      warnings,
      assumptions: [
        "Horizontal arm screened as a cantilever rectangular plate, I = b·t³/12, load at the tip.",
        "The vertical leg is mesh geometry and is not in this stress check.",
        "Euler-Bernoulli, linear-static, small deflection; self-weight is not included.",
      ],
    };
  },
});
