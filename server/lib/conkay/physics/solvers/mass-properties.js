// server/lib/conkay/physics/solvers/mass-properties.js
//
// Centre of gravity and inertia of an assembly, and a vehicle's axle loads.
//
// mass.cg: CG = Σ mᵢ·rᵢ / Σ mᵢ over the parts (and sub-assemblies) it
// contains, each at its own position. Inertia about the CG by the parallel
// axis theorem. A box or plate adds its own inertia (its dimensions run
// along x, y, z: length, width, height or thickness); any other shape is
// counted as a point mass, and the receipt lists which ones. A part without
// a position makes the CG not computed: nothing is assumed to sit at the
// origin.
//
// vehicle.axle-loads: static split of the weight between the axles from the
// CG's x and the axle positions (x increases toward the rear).

import { registerSolver } from "../registry.js";
import { LOGICAL_KINDS } from "../../compiler/design-ir.js";

const G = 9.80665;

function ownInertia(geometry, m) {
  if (!geometry) return null;
  let a; let b; let c; // extents along x, y, z
  if (geometry.shape === "box") [a, b, c] = [geometry.length, geometry.width, geometry.height];
  else if (geometry.shape === "plate") [a, b, c] = [geometry.length, geometry.width, geometry.thickness];
  else return null;
  return { xx: (m * (b * b + c * c)) / 12, yy: (m * (a * a + c * c)) / 12, zz: (m * (a * a + b * b)) / 12 };
}

export const massCg = registerSolver({
  id: "mass.cg",
  version: "1.0.0",
  domain: "mass.cg",
  fidelity: 1,
  method: "CG = Σm·r/Σm; inertia about the CG by the parallel-axis theorem (diagonal terms)",
  targets: (g) => g.nodesOfKind("Assembly").map((n) => n.id),
  run(ctx, id) {
    const items = [];
    const missing = [];
    const pointMasses = [];
    for (const child of ctx.children(id, "CONTAINS")) {
      if (child.kind === "Assembly") {
        const sub = ctx.result("mass.cg", child.id);
        if (sub?.status === "NOT_COMPUTED" || !sub?.outputs?.mass) { missing.push(`${child.id} (${sub?.reason || "no CG"})`); continue; }
        const o = sub.outputs;
        items.push({ id: child.id, m: o.mass.value, r: { x: o.cgX.value, y: o.cgY.value, z: o.cgZ.value }, own: { xx: o.Ixx.value, yy: o.Iyy.value, zz: o.Izz.value } });
        continue;
      }
      if (LOGICAL_KINDS.has(child.kind)) continue; // joints and other logical nodes have no body
      const mEnv = ctx.result("mass.part", child.id);
      const m = mEnv?.outputs?.mass?.value;
      if (!Number.isFinite(m)) { missing.push(`${child.id} (no mass)`); continue; }
      const pos = mEnv.outputs.centroid?.value || ctx.get(child.id, "position");
      if (!pos) { missing.push(`${child.id} (no position)`); continue; }
      const own = ownInertia(ctx.get(child.id, "geometry"), m);
      if (!own) pointMasses.push(child.id);
      items.push({ id: child.id, m, r: pos, own: own || { xx: 0, yy: 0, zz: 0 } });
    }
    if (missing.length) return { notComputed: `CG needs mass and position for ${missing.join(", ")}` };
    if (!items.length) return { notComputed: "nothing with mass in this assembly" };
    const M = items.reduce((s, i) => s + i.m, 0);
    const cg = { x: 0, y: 0, z: 0 };
    for (const i of items) for (const k of ["x", "y", "z"]) cg[k] += (i.m * i.r[k]) / M;
    const I = { xx: 0, yy: 0, zz: 0 };
    for (const i of items) {
      const d = { x: i.r.x - cg.x, y: i.r.y - cg.y, z: i.r.z - cg.z };
      I.xx += i.own.xx + i.m * (d.y * d.y + d.z * d.z);
      I.yy += i.own.yy + i.m * (d.x * d.x + d.z * d.z);
      I.zz += i.own.zz + i.m * (d.x * d.x + d.y * d.y);
    }
    return {
      inputs: { parts: { value: items.map((i) => ({ id: i.id, mass: i.m, position: i.r })), unit: "kg, m" } },
      outputs: {
        mass: { value: M, unit: "kg" },
        cgX: { value: cg.x, unit: "m" }, cgY: { value: cg.y, unit: "m" }, cgZ: { value: cg.z, unit: "m" },
        Ixx: { value: I.xx, unit: "kg·m2" }, Iyy: { value: I.yy, unit: "kg·m2" }, Izz: { value: I.zz, unit: "kg·m2" },
      },
      assumptions: [
        "Positions are part centroids in the design frame.",
        ...(pointMasses.length ? [`Counted as point masses (own inertia not included): ${pointMasses.join(", ")}.`] : []),
        "Products of inertia are not computed.",
      ],
    };
  },
});

export const axleLoads = registerSolver({
  id: "vehicle.axle-loads",
  version: "1.0.0",
  domain: "performance.weight-distribution",
  fidelity: 0,
  method: "static moment balance about the axles: front share = (x_rear − x_cg)/(x_rear − x_front)",
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.vehicle).map((n) => n.id),
  run(ctx, id) {
    // Read only the keys used, so an unrelated vehicle edit (Cd, power) doesn't rerun this.
    const v = { frontAxleX: ctx.get(id, "props.vehicle.frontAxleX"), rearAxleX: ctx.get(id, "props.vehicle.rearAxleX") };
    if (!Number.isFinite(v.frontAxleX) || !Number.isFinite(v.rearAxleX)) return { notComputed: "props.vehicle needs frontAxleX and rearAxleX" };
    const wheelbase = v.rearAxleX - v.frontAxleX;
    if (!(wheelbase > 0)) return { notComputed: "rearAxleX must be behind frontAxleX (x increases toward the rear)" };
    const cgEnv = ctx.result("mass.cg", id);
    if (!cgEnv || cgEnv.status === "NOT_COMPUTED") return { notComputed: `no CG for ${id} (${cgEnv?.reason || "missing"})` };
    const m = cgEnv.outputs.mass.value;
    const x = cgEnv.outputs.cgX.value;
    const front = (v.rearAxleX - x) / wheelbase;
    const warnings = front < 0 || front > 1 ? ["The CG is outside the wheelbase: the vehicle would tip about an axle."] : [];
    return {
      inputs: {
        mass: { value: m, unit: "kg", source: cgEnv.runId },
        cgX: { value: x, unit: "m", source: cgEnv.runId },
        frontAxleX: { value: v.frontAxleX, unit: "m" },
        rearAxleX: { value: v.rearAxleX, unit: "m" },
      },
      outputs: {
        frontShare: { value: front, unit: "1" },
        rearShare: { value: 1 - front, unit: "1" },
        frontAxleLoad: { value: m * G * front, unit: "N" },
        rearAxleLoad: { value: m * G * (1 - front), unit: "N" },
        wheelbase: { value: wheelbase, unit: "m" },
      },
      warnings,
      assumptions: ["Static, level, no aero load or load transfer."],
    };
  },
});
