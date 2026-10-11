// server/lib/conkay/physics/solvers/crush-paths.js
//
// structure.crush-paths: energy-absorption screening of the tub's existing
// front rails and rear quarter boxes. Reads those parts. Adds none.

import { registerSolver } from "../registry.js";
import { crushPaths } from "../../structural/crush-paths.js";
import { getMaterial } from "../../materials/index.js";

function metres(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return NaN;
  const m = v.trim().match(/^(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)\s*(mm|m)?$/i);
  if (!m) return NaN;
  return m[2]?.toLowerCase() === "mm" ? Number(m[1]) / 1000 : Number(m[1]);
}

function boxX(box) {
  // World x is component 0. The tube's long axis is not always x (the rear
  // cross runs across the car), and these boxes are axis-aligned.
  if (!Array.isArray(box?.center) || !Array.isArray(box?.half)) return null;
  const c = box.center[0], h = box.half[0];
  if (!(Number.isFinite(c) && h > 0)) return null;
  return { x0: c - h, x1: c + h };
}

function sectionOf(ctx, partId) {
  const g = ctx.get(partId, "geometry");
  const box = boxX(ctx.get(partId, "props.tubBox"));
  const c = metres(g?.width), d = metres(g?.height), h = metres(g?.wall);
  const lengthM = metres(g?.length);
  if (!(c > 0 && d > 0 && h > 0 && lengthM > 0 && box)) return null;
  return { id: partId, c, d, h, lengthM, x0: box.x0, xBoxEnd: box.x1 };
}

export const crushPathSolver = registerSolver({
  id: "structure.crush-paths",
  version: "1.0.0",
  domain: "structural.crash",
  fidelity: 1,
  method: "Wierzbicki and Abramowicz 1983 mean crush force on the existing rectangular rails, compared with ½mv² at the FMVSS 208 barrier speeds. Not a crash test and not a shell model.",
  reference: "server/lib/conkay/structural/crush-paths.js",
  regime: "rigid-plastic quasi-static symmetric folding of a thin-walled rectangular tube; outside that the energy is not a capacity",
  units: { inputs: "m, Pa, kg", outputs: "N, J" },
  screening: true,
  targets: (g) => [...g.nodes.values()]
    .filter((n) => Array.isArray(n.props?.frameModel?.members)
      && n.props.frameModel.members.some((m) => typeof m.part === "string" && m.part.startsWith("TUB_RAIL_F")))
    .map((n) => n.id),
  run(ctx, id) {
    const fm = ctx.get(id, "props.frameModel");
    const nodes = new Map((fm.nodes || []).map((n) => [n.id, n]));
    const nx = (nodeId) => nodes.get(nodeId)?.x;
    const partIds = [...new Set((fm.members || []).map((m) => m.part).filter((p) => typeof p === "string"))];
    const rails = partIds.filter((p) => p.startsWith("TUB_RAIL_F")).sort();
    const quarters = partIds.filter((p) => p.startsWith("TUB_QTR_")).sort();
    if (!rails.length) return { notComputed: "no front-rail parts on this frame" };

    const frontRails = [];
    for (const partId of rails) {
      const sec = sectionOf(ctx, partId);
      if (!sec) return { notComputed: `${partId} has no rectangular-tube section or tub box` };
      const side = partId.endsWith("L") ? "L" : partId.endsWith("R") ? "R" : null;
      const xAxle = side ? nx(`FA.${side}`) : NaN;
      if (!Number.isFinite(xAxle)) return { notComputed: `${partId} has no front-axle node` };
      frontRails.push({ ...sec, xAxle });
    }
    const cross = sectionOf(ctx, "TUB_REAR_CROSS");
    const rearQuarters = [];
    for (const partId of quarters) {
      const sec = sectionOf(ctx, partId);
      if (!sec) return { notComputed: `${partId} has no rectangular-tube section or tub box` };
      const side = partId.endsWith("L") ? "L" : partId.endsWith("R") ? "R" : null;
      const xAxle = side ? nx(`QA.${side}`) : NaN;
      if (!Number.isFinite(xAxle)) return { notComputed: `${partId} has no rear-axle node` };
      rearQuarters.push({ ...sec, xAxle, xTip: sec.xBoxEnd, xCrossRear: cross ? cross.xBoxEnd : null });
    }

    const mat = ctx.material(rails[0]);
    if (!(mat?.yieldPa > 0) || !(mat.youngsModulusPa > 0) || !(mat.poisson > 0)) {
      return { notComputed: `${rails[0]} material needs yield, E and Poisson` };
    }
    const lib = getMaterial(mat.id);

    const masses = [];
    const bd = ctx.result("mass.breakdown", "VEH");
    const kerb = bd?.outputs?.totalMass?.value;
    if (kerb > 0) masses.push({ id: "kerb", kg: kerb, note: bd.outputs.totalMass.note || "mass.breakdown total" });
    const req = ctx.requirement("REQ_mass");
    const briefKg = req?.max?.si ?? req?.max?.value;
    if (briefKg > 0) masses.push({ id: "brief-max", kg: briefKg, note: req.label || "brief mass maximum" });

    const result = crushPaths({
      frontRails,
      rearQuarters,
      sigma0Pa: mat.yieldPa,
      ultimatePa: mat.ultimatePa ?? null,
      youngsPa: mat.youngsModulusPa,
      nu: mat.poisson,
      materialId: mat.id,
      materialNote: lib?.source || `${mat.id} yield ${(mat.yieldPa / 1e6).toFixed(0)} MPa from the material library; that row has no source field`,
      masses,
    });

    return {
      inputs: {
        material: { value: result.material.id, source: result.material.note },
        sigma0Pa: { value: result.material.sigma0Pa, unit: "Pa", source: result.material.sigma0Basis },
        frontRails: { value: frontRails.map((r) => r.id) },
        rearQuarters: { value: rearQuarters.map((r) => r.id) },
      },
      outputs: {
        dedicatedCrashBox: { value: false },
        squareFormulaApplied: { value: false },
        frontEnergyJ: { value: result.front.energyJ, unit: "J", note: result.front.energyStatus },
        rearEnergyJ: { value: null, unit: "J", note: result.rear.energyStatus },
        paths: { value: result },
      },
      margins: [],
      warnings: result.warnings,
      assumptions: result.assumptions,
    };
  },
});
