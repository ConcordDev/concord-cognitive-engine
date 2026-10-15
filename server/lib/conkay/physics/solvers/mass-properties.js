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
// origin. The full 6-component inertia tensor is reported: Ixx, Iyy, Izz
// (diagonal) and Ixy, Ixz, Iyz (products of inertia). For box/plate shapes
// the own products are zero by symmetry, so the reported products come
// entirely from the parallel-axis contribution and are non-zero whenever
// the part centroids do not share the assembly's principal axes (e.g. an
// L-shape). The products are not "assumed zero" — they are computed.
//
// vehicle.axle-loads: static split of the weight between the axles from the
// CG's x and the axle positions (x increases toward the rear).

import { registerSolver } from "../registry.js";
import { LOGICAL_KINDS } from "../../compiler/design-ir.js";

const G = 9.80665;

// ownInertia: returns the 6-component inertia tensor of a part about its
// own centroid, in the part's local axes. For box/plate shapes, the
// products of inertia (Ixy, Ixz, Iyz) are zero by symmetry; for any other
// shape we return the diagonal terms only and the caller treats the part
// as a point mass for the products (which is the conservative limit).
function ownInertia(geometry, m) {
  if (!geometry) return null;
  let a; let b; let c; // extents along x, y, z
  if (geometry.shape === "box") [a, b, c] = [geometry.length, geometry.width, geometry.height];
  else if (geometry.shape === "plate") [a, b, c] = [geometry.length, geometry.width, geometry.thickness];
  else return null;
  return {
    xx: (m * (b * b + c * c)) / 12,
    yy: (m * (a * a + c * c)) / 12,
    zz: (m * (a * a + b * b)) / 12,
    xy: 0, xz: 0, yz: 0, // box/plate is symmetric about its own axes
  };
}

export const massCg = registerSolver({
  id: "mass.cg",
  version: "1.1.0",
  domain: "mass.cg",
  fidelity: 1,
  method: "CG = Σm·r/Σm; full 6-component inertia tensor about the CG by the parallel-axis theorem. For box/plate parts, own products are zero (symmetry); assembly products come from Σ(−mᵢ·dᵢ⨯dᵢ) over each part. Hand-calc validation in scripts/test-cg-tensor.mjs.",
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
        items.push({
          id: child.id,
          m: o.mass.value,
          r: { x: o.cgX.value, y: o.cgY.value, z: o.cgZ.value },
          own: {
            xx: o.Ixx.value, yy: o.Iyy.value, zz: o.Izz.value,
            xy: o.Ixy?.value ?? 0, xz: o.Ixz?.value ?? 0, yz: o.Iyz?.value ?? 0,
          },
        });
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
      items.push({ id: child.id, m, r: pos, own: own || { xx: 0, yy: 0, zz: 0, xy: 0, xz: 0, yz: 0 } });
    }
    if (missing.length) return { notComputed: `CG needs mass and position for ${missing.join(", ")}` };
    if (!items.length) return { notComputed: "nothing with mass in this assembly" };
    const M = items.reduce((s, i) => s + i.m, 0);
    const cg = { x: 0, y: 0, z: 0 };
    for (const i of items) for (const k of ["x", "y", "z"]) cg[k] += (i.m * i.r[k]) / M;
    // Full 6-component inertia tensor about the CG. The parallel-axis
    // contribution for each part: I_part = I_own + m·(|d|²·E − d⊗d), where
    // d = r_i − r_cg. The diagonal terms are ΣI_xx_own + m·(dy² + dz²);
    // the products are ΣI_xy_own − m·dx·dy.
    const I = { xx: 0, yy: 0, zz: 0, xy: 0, xz: 0, yz: 0 };
    for (const i of items) {
      const d = { x: i.r.x - cg.x, y: i.r.y - cg.y, z: i.r.z - cg.z };
      const dx = d.x, dy = d.y, dz = d.z;
      I.xx += i.own.xx + i.m * (dy * dy + dz * dz);
      I.yy += i.own.yy + i.m * (dx * dx + dz * dz);
      I.zz += i.own.zz + i.m * (dx * dx + dy * dy);
      I.xy += i.own.xy - i.m * dx * dy;
      I.xz += i.own.xz - i.m * dx * dz;
      I.yz += i.own.yz - i.m * dy * dz;
    }
    // Quick sanity check: a symmetric tensor would have principal axes
    // coincident with the design axes; an L-shape does not. We don't
    // diagonalize here — that belongs to a moment-of-inertia display
    // solver, not the CG aggregator — but we expose the raw tensor for it.
    return {
      inputs: { parts: { value: items.map((i) => ({ id: i.id, mass: i.m, position: i.r })), unit: "kg, m" } },
      outputs: {
        mass: { value: M, unit: "kg" },
        cgX: { value: cg.x, unit: "m" }, cgY: { value: cg.y, unit: "m" }, cgZ: { value: cg.z, unit: "m" },
        Ixx: { value: I.xx, unit: "kg·m²" }, Iyy: { value: I.yy, unit: "kg·m²" }, Izz: { value: I.zz, unit: "kg·m²" },
        Ixy: { value: I.xy, unit: "kg·m²" }, Ixz: { value: I.xz, unit: "kg·m²" }, Iyz: { value: I.yz, unit: "kg·m²" },
      },
      assumptions: [
        "Positions are part centroids in the design frame.",
        ...(pointMasses.length ? [`Counted as point masses (own inertia not included, products not contributed): ${pointMasses.join(", ")}`] : []),
        "Full 6-component tensor reported. Products of inertia are NOT assumed zero — they are computed from the parallel-axis contribution. For an L-shape or any off-axis assembly they are non-zero.",
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
