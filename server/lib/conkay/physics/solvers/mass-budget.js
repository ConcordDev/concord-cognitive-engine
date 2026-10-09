// server/lib/conkay/physics/solvers/mass-budget.js
//
// Mass budget and centre of gravity for an assembly built from a component
// list (Sentinel/RAM spec 4.3: "Missing mass is a gap, not zero").
//
// Unlike mass.cg (which needs every part to have geometry), a body here can
// get its mass three ways, and the receipt says which:
//   - geometry + material → the mass.part solver (computed),
//   - a stated props.mass (kg) with its #1037 props.massState: "sourced"
//     (datasheet URL + variant) or "estimated" (method + range); or with
//     props.massRequirement (a user requirement, stated with massSource),
//   - props.battery { series, parallel, cell: { massKg, ... } } → cells × cell
//     mass (computed from a sourced cell mass).
// A "placeholder" mass state, a stated mass with no mass state, or no mass
// at all puts the item on the unknown list; it is never counted as zero mass
// silently: the CG is the CG of the KNOWN mass, labelled so, with every
// unknown named.

import { registerSolver } from "../registry.js";
import { describeMassState } from "./mass-cost.js";

const STATES = ["sourced", "computed", "estimated", "requirement"];

/** Walk CONTAINS edges, flattening sub-assemblies. */
function bodies(ctx, id, out = []) {
  for (const child of ctx.children(id, "CONTAINS")) {
    if (child.kind === "Assembly") bodies(ctx, child.id, out);
    else out.push(child);
  }
  return out;
}

/** Mass of one body: { mass, state, source } or { unknown: reason }. */
export function bodyMass(ctx, n) {
  const bat = ctx.get(n.id, "props.battery");
  if (bat) {
    const cells = bat.series * bat.parallel;
    if (!Number.isFinite(cells) || !Number.isFinite(bat.cell?.massKg)) return { unknown: "battery needs series, parallel and cell.massKg" };
    return { mass: cells * bat.cell.massKg, state: "computed", source: `${cells} cells × ${bat.cell.massKg} kg (${bat.cell.source})`, note: "cells only" };
  }
  const pm = ctx.get(n.id, "props.mass");
  const ms = ctx.get(n.id, "props.massState");
  if (ms?.state === "placeholder") return { unknown: ms.note || "placeholder mass" };
  if (Number.isFinite(pm)) {
    if (ms?.state === "sourced" || ms?.state === "estimated") return { mass: pm, state: ms.state, source: describeMassState(ms) };
    if (!ms && ctx.get(n.id, "props.massRequirement") === true) return { mass: pm, state: "requirement", source: ctx.get(n.id, "props.massSource") || null };
    return { unknown: `stated mass ${pm} kg has no mass state (${ctx.get(n.id, "props.massSource") || "no source"}): a placeholder, not counted` };
  }
  if (n.geometry) {
    const env = ctx.result("mass.part", n.id);
    const m = env?.outputs?.mass?.value;
    if (Number.isFinite(m)) return { mass: m, state: "computed", source: `${env.runId} (${env.inputs?.material?.value}, ${env.inputs?.material?.basis})` };
    return { unknown: env?.reason || "mass.part not computed" };
  }
  return { unknown: "no geometry, datasheet mass or estimate" };
}

export const massBudget = registerSolver({
  id: "mass.budget",
  version: "1.1.0",
  domain: "mass.budget",
  domains: ["mass", "mass.cg", "mass.budget"],
  fidelity: 1,
  method: "Σ known masses by state; CG = Σm·r/Σm over known masses; unknown masses listed, never zeroed",
  regime: "rigid assembly in one stated pose",
  units: { inputs: "kg, m", outputs: "kg, m" },
  tolerance: "exact arithmetic",
  screening: false,
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.massBudget).map((n) => n.id),
  run(ctx, id) {
    const items = [];
    const unknown = [];
    for (const n of bodies(ctx, id)) {
      if (ctx.get(n.id, "props.logical")) continue;
      const m = bodyMass(ctx, n);
      if (m.unknown) { unknown.push({ id: n.id, name: n.name, reason: m.unknown }); continue; }
      const pos = ctx.get(n.id, "position");
      if (!pos) { unknown.push({ id: n.id, name: n.name, reason: `mass ${m.mass.toFixed(3)} kg known but no position: excluded from CG` }); continue; }
      items.push({ id: n.id, name: n.name, mass: m.mass, state: m.state, source: m.source, position: pos });
    }
    if (!items.length) return { notComputed: "no body with a known mass" };
    const M = items.reduce((s, i) => s + i.mass, 0);
    const cg = { x: 0, y: 0, z: 0 };
    for (const i of items) for (const k of ["x", "y", "z"]) cg[k] += (i.mass * i.position[k]) / M;
    const byState = Object.fromEntries(STATES.map((s) => [s, items.filter((i) => i.state === s).reduce((t, i) => t + i.mass, 0)]));
    return {
      inputs: { items: { value: items.map(({ id: i, mass, state, position }) => ({ id: i, mass, state, position })), unit: "kg, m" } },
      outputs: {
        knownMass: { value: M, unit: "kg" },
        cgX: { value: cg.x, unit: "m" }, cgY: { value: cg.y, unit: "m" }, cgZ: { value: cg.z, unit: "m" },
        massByState: { value: byState, unit: "kg" },
        items: { value: items },
        unknownItems: { value: unknown },
        unknownCount: { value: unknown.length, unit: "1" },
      },
      warnings: unknown.length ? [`mass budget does not close: ${unknown.length} item(s) of unknown mass (${unknown.map((u) => u.id).join(", ")}); total and CG are of the known mass only`] : [],
      assumptions: ["Positions are body centroids in the design frame for the stated pose.", "Estimated masses carry their stated ranges; they are not datasheet values."],
    };
  },
});
