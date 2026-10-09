// server/lib/conkay/physics/solvers/mass-cost.js
//
// Mass and cost: part mass from geometry × density, assembly roll-ups, and
// part cost from mass × a price per kg. A part with no density or no price is
// NOT_COMPUTED with the reason, never given a stand-in value.

import { registerSolver } from "../registry.js";
import { LOGICAL_KINDS } from "../../compiler/design-ir.js";

const PI = Math.PI;

// Surface area of an ellipsoid with semi-axes a, b, c: Knud Thomsen's
// formula, p = 1.6075, relative error at most 1.061%.
export function ellipsoidArea(a, b, c) {
  const p = 1.6075;
  return 4 * PI * (((a * b) ** p + (a * c) ** p + (b * c) ** p) / 3) ** (1 / p);
}

function volumeM3(g) {
  switch (g.shape) {
    case "box": return g.length * g.width * g.height;
    case "plate": return g.length * g.width * g.thickness;
    case "cylinder":
    case "rod":
    case "bolt": return (PI * g.diameter * g.diameter / 4) * g.length;
    case "shell": return g.area * g.thickness;
    case "ellipsoid-shell": return ellipsoidArea(g.length / 2, g.width / 2, g.height / 2) * g.thickness;
    case "i-beam": return (2 * g.flangeWidth * g.flangeThickness + (g.height - 2 * g.flangeThickness) * g.webThickness) * g.length;
    default: return null;
  }
}

const SHAPE_NOTE = {
  "ellipsoid-shell": "Thin skin on an ellipsoid of the overall dimensions: area by Thomsen's formula (≤1.061% error) × thickness. A real body is not an ellipsoid; screening only.",
  bolt: "Bolt modelled as its shank (π·d²/4·L): head, nut, washers and thread loss are not included, so mass is understated.",
};

const hasStated = (n, k) => Number.isFinite(n.props?.[k]);

// Where a stated mass comes from, in words, for the receipt.
export function describeMassState(ms) {
  if (!ms) return null;
  if (ms.state === "sourced") return `sourced: ${ms.source?.title || ms.source?.url || ms.source?.document} (${ms.variant})`;
  if (ms.state === "estimated") {
    const u = ms.uncertainty || {};
    return `estimated: ${ms.method} (range ${u.pct != null ? `±${u.pct}%` : `${u.lowKg}–${u.highKg} kg`})`;
  }
  if (ms.state === "placeholder") return `placeholder: ${ms.note}`;
  return `${ms.state}`;
}

export const massPart = registerSolver({
  id: "mass.part",
  version: "1.2.0",
  domain: "mass",
  fidelity: 1,
  method: "m = V·ρ, volume from the part's parametric geometry; or a stated mass with its source. Every mass carries a mass state (sourced / estimated / computed / placeholder).",
  targets: (g) => [...g.nodes.values()].filter((n) => n.geometry || hasStated(n, "mass")).map((n) => n.id),
  run(ctx, id) {
    const stated = ctx.get(id, "props.mass");
    const declared = ctx.get(id, "props.massState");
    if (Number.isFinite(stated)) {
      const source = ctx.get(id, "props.massSource") || describeMassState(declared);
      // A stated mass with only a free-text source has no mass state: it is
      // not shown to be sourced, estimated or computed, so it is a placeholder.
      const massState = declared || { state: "placeholder", note: `stated mass with no mass state (source given: ${source})` };
      return {
        inputs: { statedMass: { value: stated, unit: "kg", source } },
        outputs: { mass: { value: stated, unit: "kg", basis: "stated" }, massState: { value: massState.state, detail: massState } },
        assumptions: [`Stated mass, not computed: ${source}.`],
      };
    }
    const geometry = ctx.get(id, "geometry");
    const mat = ctx.material(id);
    if (!mat) return { notComputed: "no material assigned" };
    const rho = mat.densityKgM3;
    if (rho == null) return { notComputed: `${mat.label} has no density` };
    const V = volumeM3(geometry);
    const computed = { state: "computed", geometryRef: `${id}.geometry (${geometry.shape})`, materialRef: `${mat.id} (density: ${mat.source})` };
    // Stand-in geometry (not a designed part) stays a placeholder even though its mass is V·ρ.
    const massState = declared?.state === "placeholder" ? { ...declared, computedFrom: computed } : computed;
    return {
      inputs: {
        shape: { value: geometry.shape },
        ...Object.fromEntries(Object.entries(geometry).filter(([k]) => k !== "shape").map(([k, v]) => [k, { value: v, unit: k === "area" ? "m2" : "m" }])),
        material: { value: mat.id, source: mat.source, basis: mat.basis },
        density: { value: rho, unit: "kg/m3", source: mat.source },
      },
      outputs: { volume: { value: V, unit: "m3" }, mass: { value: V * rho, unit: "kg" }, massState: { value: massState.state, detail: massState } },
      assumptions: [
        ...(SHAPE_NOTE[geometry.shape] ? [SHAPE_NOTE[geometry.shape]] : []),
        ...(massState.state === "placeholder" ? [`Placeholder: ${declared.note}`] : []),
      ],
    };
  },
});

// Sum an output over an assembly's contents. Payload (people, cargo) is
// kept out of the product's own total and reported separately as gross.
function rollup(ctx, id, partSolver, asmSolver, output, unit, { withGross = false } = {}) {
  const parts = [];
  const missing = [];
  let total = 0;
  let payload = 0;
  const skipped = [];
  for (const child of ctx.children(id, "CONTAINS")) {
    // Joints, interfaces and other logical nodes have no body of their own.
    if (child.kind !== "Assembly" && LOGICAL_KINDS.has(child.kind)) { skipped.push(child.id); continue; }
    if (child.kind === "Payload" && !withGross) continue;
    const env = child.kind === "Assembly" ? ctx.result(asmSolver, child.id) : ctx.result(partSolver, child.id);
    const v = env?.outputs?.[output]?.value;
    if (!Number.isFinite(v)) { missing.push(`${child.id} (${env ? env.reason || env.status : "no geometry"})`); continue; }
    if (child.kind === "Payload") payload += v;
    else {
      total += v;
      if (child.kind === "Assembly" && withGross) payload += (env.outputs.grossMass?.value ?? v) - v;
    }
    parts.push({ id: child.id, [output]: v });
  }
  if (missing.length) return { notComputed: `${output} missing for ${missing.join(", ")}`, inputs: { parts: { value: parts } } };
  // An assembly with nothing in it is not "0 kg": it hasn't been designed yet.
  if (!parts.length) return { notComputed: `nothing with ${output} in this assembly yet` };
  return {
    inputs: { parts: { value: parts, unit }, ...(skipped.length ? { skipped: { value: skipped, note: "no geometry of their own" } } : {}) },
    outputs: {
      [output]: { value: total, unit },
      ...(withGross ? { payload: { value: payload, unit }, grossMass: { value: total + payload, unit } } : {}),
    },
  };
}

export const massAssembly = registerSolver({
  id: "mass.assembly",
  version: "1.1.0",
  domain: "mass",
  fidelity: 0,
  method: "Σ mass of contained parts and sub-assemblies; payload reported separately (grossMass)",
  targets: (g) => g.nodesOfKind("Assembly").map((n) => n.id),
  run: (ctx, id) => rollup(ctx, id, "mass.part", "mass.assembly", "mass", "kg", { withGross: true }),
});

export const costPart = registerSolver({
  id: "cost.part",
  version: "1.1.0",
  domain: "cost",
  fidelity: 0,
  method: "material cost = mass × price per kg (raw material only); or a stated unit cost with its source",
  targets: (g) => [...g.nodes.values()].filter((n) => n.kind !== "Payload" && (n.geometry || hasStated(n, "mass") || hasStated(n, "unitCost"))).map((n) => n.id),
  run(ctx, id) {
    const unitCost = ctx.get(id, "props.unitCost");
    if (Number.isFinite(unitCost)) {
      const source = ctx.get(id, "props.unitCostSource");
      return { inputs: { unitCost: { value: unitCost, unit: "USD", source } }, outputs: { cost: { value: unitCost, unit: "USD", basis: "stated" } }, assumptions: [`Stated unit cost: ${source}.`] };
    }
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
