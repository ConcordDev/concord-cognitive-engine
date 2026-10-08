// server/lib/conkay/physics/solvers/mass-cost.js
//
// Mass and cost: part mass from geometry × density, assembly roll-ups, and
// part cost from mass × a price per kg. A part with no density or no price is
// NOT_COMPUTED with the reason, never given a stand-in value.

import { registerSolver } from "../registry.js";

const PI = Math.PI;

function volumeM3(g) {
  switch (g.shape) {
    case "box": return g.length * g.width * g.height;
    case "plate": return g.length * g.width * g.thickness;
    case "cylinder":
    case "rod":
    case "bolt": return (PI * g.diameter * g.diameter / 4) * g.length;
    default: return null;
  }
}

const SHAPE_NOTE = {
  bolt: "Bolt modelled as its shank (π·d²/4·L): head, nut, washers and thread loss are not included, so mass is understated.",
};

export const massPart = registerSolver({
  id: "mass.part",
  version: "1.0.0",
  domain: "mass",
  fidelity: 1,
  method: "m = V·ρ, volume from the part's parametric geometry",
  targets: (g) => [...g.nodes.values()].filter((n) => n.geometry).map((n) => n.id),
  run(ctx, id) {
    const geometry = ctx.get(id, "geometry");
    const mat = ctx.material(id);
    if (!mat) return { notComputed: "no material assigned" };
    const rho = mat.densityKgM3;
    if (rho == null) return { notComputed: `${mat.label} has no density` };
    const V = volumeM3(geometry);
    return {
      inputs: {
        shape: { value: geometry.shape },
        ...Object.fromEntries(Object.entries(geometry).filter(([k]) => k !== "shape").map(([k, v]) => [k, { value: v, unit: "m" }])),
        material: { value: mat.id, source: mat.source },
        density: { value: rho, unit: "kg/m3", source: mat.source },
      },
      outputs: { volume: { value: V, unit: "m3" }, mass: { value: V * rho, unit: "kg" } },
      assumptions: SHAPE_NOTE[geometry.shape] ? [SHAPE_NOTE[geometry.shape]] : [],
    };
  },
});

function rollup(ctx, id, partSolver, asmSolver, output, unit) {
  const parts = [];
  const missing = [];
  let total = 0;
  const skipped = [];
  for (const child of ctx.children(id, "CONTAINS")) {
    // Joints, interfaces and other logical nodes have no body of their own.
    if (child.kind !== "Assembly" && !child.geometry) { skipped.push(child.id); continue; }
    const env = child.kind === "Assembly" ? ctx.result(asmSolver, child.id) : ctx.result(partSolver, child.id);
    const v = env?.outputs?.[output]?.value;
    if (!Number.isFinite(v)) { missing.push(`${child.id} (${env ? env.reason || env.status : "no geometry"})`); continue; }
    total += v;
    parts.push({ id: child.id, [output]: v });
  }
  if (missing.length) return { notComputed: `${output} missing for ${missing.join(", ")}`, inputs: { parts: { value: parts } } };
  return {
    inputs: { parts: { value: parts, unit }, ...(skipped.length ? { skipped: { value: skipped, note: "no geometry of their own" } } : {}) },
    outputs: { [output]: { value: total, unit } },
  };
}

export const massAssembly = registerSolver({
  id: "mass.assembly",
  version: "1.0.0",
  domain: "mass",
  fidelity: 0,
  method: "Σ mass of contained parts and sub-assemblies",
  targets: (g) => g.nodesOfKind("Assembly").map((n) => n.id),
  run: (ctx, id) => rollup(ctx, id, "mass.part", "mass.assembly", "mass", "kg"),
});

export const costPart = registerSolver({
  id: "cost.part",
  version: "1.0.0",
  domain: "cost",
  fidelity: 0,
  method: "material cost = mass × price per kg (raw material only)",
  targets: (g) => [...g.nodes.values()].filter((n) => n.geometry).map((n) => n.id),
  run(ctx, id) {
    const m = ctx.result("mass.part", id);
    const mass = m?.outputs?.mass?.value;
    if (!Number.isFinite(mass)) return { notComputed: `no mass for ${id}` };
    const mat = ctx.material(id);
    const price = mat?.costPerKgUsd;
    if (price == null) return { notComputed: `no price per kg for ${mat?.label || "this material"}` };
    const source = mat.costSource || "library indicative price";
    return {
      inputs: { mass: { value: mass, unit: "kg", source: m.runId }, price: { value: price, unit: "USD/kg", source } },
      outputs: { cost: { value: mass * price, unit: "USD" } },
      assumptions: ["Raw material only: machining, finishing and labour are not included."],
    };
  },
});

export const costAssembly = registerSolver({
  id: "cost.assembly",
  version: "1.0.0",
  domain: "cost",
  fidelity: 0,
  method: "Σ material cost of contained parts and sub-assemblies",
  targets: (g) => g.nodesOfKind("Assembly").map((n) => n.id),
  run: (ctx, id) => rollup(ctx, id, "cost.part", "cost.assembly", "cost", "USD"),
});
