// server/lib/conkay/compiler/design-ir.js
//
// The ConKay Design IR: the typed, unit-aware spec a brief compiles to.
// Generic on purpose: the same node kinds and edge types describe a bolt, a
// car or a building. compileDesignIR validates it and converts every
// quantity to SI. It reports every problem it finds instead of filling in
// defaults.
//
// {
//   design:       { id, name }
//   materials:    { [materialId]: { costPerKgUsd: "9 USD/kg", source } }  // user prices / overrides
//   nodes:        [{ id, kind, name?, material?, geometry?: { shape, ...quantities }, props? }]
//   edges:        [{ type, from, to, props? }]
//   loadCases:    [{ id, label?, loads: [{ target, shear?, tension?, pointLoad?, compression? }] }]
//   requirements: [{ id, label, of: { solver, target, output }, max?: q, min?: q }]
// }

import { parseQuantity } from "./units.js";
import { getMaterial } from "../materials/index.js";

export const NODE_KINDS = new Set([
  "Part", "Assembly", "Volume", "Surface", "Beam", "Shell", "Solid", "Joint", "Constraint", "Load",
  "Field", "Material", "Fluid", "Circuit", "Actuator", "Sensor", "HeatSource", "HeatSink", "Boundary",
  "Interface", "Process",
  // Common specializations of Part.
  "Bolt", "Plate",
]);

export const EDGE_TYPES = new Set([
  "BOLTED_TO", "WELDED_TO", "MATED_TO", "CONSTRAINS", "LOADS", "SUPPORTS", "CONDUCTS", "CONTAINS",
  "THERMALLY_COUPLED_TO", "FLUID_CONNECTED_TO", "ELECTRICALLY_CONNECTED_TO", "MANUFACTURED_BY", "DEPENDS_ON",
]);

// Geometry shapes and the length parameters each one needs.
export const SHAPES = {
  box: ["length", "width", "height"],
  plate: ["length", "width", "thickness"],
  cylinder: ["diameter", "length"],
  rod: ["diameter", "length"],
  bolt: ["diameter", "length"],
  "i-beam": ["length", "height", "flangeWidth", "flangeThickness", "webThickness"],
};

// shear/tension act on joints; pointLoad (midspan, or the tip of a
// cantilever) and compression (axial) act on beams.
const LOAD_KEYS = { shear: "force", tension: "force", pointLoad: "force", compression: "force" };

// Node props that carry a unit; converted to SI like geometry. Other props
// are passed through as plain values.
export const TYPED_PROPS = { maxPower: "power" };
const TYPED_VEHICLE_PROPS = { frontalArea: "area", airDensity: "density" };

export const LIMITS = { nodes: 2000, edges: 5000, loadCases: 200, requirements: 500 };

export function compileDesignIR(ir) {
  const errors = [];
  if (!ir || typeof ir !== "object") return { ok: false, errors: ["design IR must be an object"] };
  for (const [k, max] of Object.entries(LIMITS)) {
    if (Array.isArray(ir[k]) && ir[k].length > max) return { ok: false, errors: [`${k}: at most ${max} (got ${ir[k].length})`] };
  }
  const design = { id: String(ir.design?.id || "design"), name: String(ir.design?.name || ir.design?.id || "Untitled design") };

  const materialOverrides = {};
  for (const [id, o] of Object.entries(ir.materials || {})) {
    if (!getMaterial(id)) { errors.push(`materials.${id}: unknown material`); continue; }
    const entry = { source: o?.source ? String(o.source) : "user-supplied" };
    if (o?.costPerKgUsd != null) {
      const q = parseQuantity(o.costPerKgUsd, "price_per_mass");
      if (!q.ok) errors.push(`materials.${id}.costPerKgUsd: ${q.error}`);
      else if (q.si < 0) errors.push(`materials.${id}.costPerKgUsd: must not be negative`);
      else entry.costPerKgUsd = q.si;
    }
    materialOverrides[id] = entry;
  }

  const nodes = [];
  const ids = new Set();
  for (const [i, n] of (Array.isArray(ir.nodes) ? ir.nodes : []).entries()) {
    const where = `nodes[${i}]${n?.id ? ` (${n.id})` : ""}`;
    const id = String(n?.id || "").trim();
    if (!id) { errors.push(`${where}: id required`); continue; }
    if (ids.has(id)) { errors.push(`${where}: duplicate id`); continue; }
    ids.add(id);
    if (!NODE_KINDS.has(n.kind)) { errors.push(`${where}: unknown kind "${n.kind}"`); continue; }
    const node = { id, kind: n.kind, name: String(n.name || id), material: null, geometry: null, props: { ...(n.props || {}) } };
    for (const [k, dim] of Object.entries(TYPED_PROPS)) {
      if (node.props[k] == null) continue;
      const q = parseQuantity(node.props[k], dim);
      if (!q.ok) errors.push(`${where}.props.${k}: ${q.error}`);
      else if (q.si <= 0) errors.push(`${where}.props.${k}: must be positive`);
      else node.props[k] = q.si;
    }
    if (node.props.vehicle && typeof node.props.vehicle === "object") {
      const veh = { ...node.props.vehicle };
      for (const [k, dim] of Object.entries(TYPED_VEHICLE_PROPS)) {
        if (veh[k] == null || typeof veh[k] === "number") continue;
        const q = parseQuantity(veh[k], dim);
        if (!q.ok) errors.push(`${where}.props.vehicle.${k}: ${q.error}`);
        else veh[k] = q.si;
      }
      node.props.vehicle = veh;
    }
    if (n.material != null) {
      if (!getMaterial(n.material)) errors.push(`${where}: unknown material "${n.material}"`);
      else node.material = n.material;
    }
    if (n.geometry != null) {
      const shape = n.geometry.shape;
      if (!SHAPES[shape]) errors.push(`${where}: unknown shape "${shape}"`);
      else {
        const geometry = { shape };
        for (const key of SHAPES[shape]) {
          const q = parseQuantity(n.geometry[key], "length");
          if (!q.ok) errors.push(`${where}.geometry.${key}: ${q.error}`);
          else if (q.si <= 0) errors.push(`${where}.geometry.${key}: must be positive`);
          else geometry[key] = q.si;
        }
        node.geometry = geometry;
      }
    }
    nodes.push(node);
  }

  const edges = [];
  for (const [i, e] of (Array.isArray(ir.edges) ? ir.edges : []).entries()) {
    if (!EDGE_TYPES.has(e?.type)) { errors.push(`edges[${i}]: unknown type "${e?.type}"`); continue; }
    if (!ids.has(e.from)) errors.push(`edges[${i}]: unknown node "${e.from}"`);
    if (!ids.has(e.to)) errors.push(`edges[${i}]: unknown node "${e.to}"`);
    edges.push({ type: e.type, from: e.from, to: e.to, props: { ...(e.props || {}) } });
  }

  const loadCases = [];
  for (const [i, lc] of (Array.isArray(ir.loadCases) ? ir.loadCases : []).entries()) {
    const loads = [];
    for (const [j, l] of (Array.isArray(lc?.loads) ? lc.loads : []).entries()) {
      if (!ids.has(l?.target)) { errors.push(`loadCases[${i}].loads[${j}]: unknown target "${l?.target}"`); continue; }
      const load = { target: l.target };
      for (const [k, dim] of Object.entries(LOAD_KEYS)) {
        if (l[k] == null) continue;
        const q = parseQuantity(l[k], dim);
        if (!q.ok) errors.push(`loadCases[${i}].loads[${j}].${k}: ${q.error}`);
        else load[k] = q.si;
      }
      loads.push(load);
    }
    loadCases.push({ id: String(lc?.id || `lc${i + 1}`), label: String(lc?.label || lc?.id || `Load case ${i + 1}`), loads });
  }

  const requirements = [];
  for (const [i, r] of (Array.isArray(ir.requirements) ? ir.requirements : []).entries()) {
    const where = `requirements[${i}]`;
    if (!r?.id) { errors.push(`${where}: id required`); continue; }
    if (!r.of?.solver || !r.of?.target || !r.of?.output) { errors.push(`${where}: of.{solver,target,output} required`); continue; }
    const req = { id: String(r.id), label: String(r.label || r.id), of: { ...r.of } };
    for (const bound of ["max", "min"]) {
      if (r[bound] == null) continue;
      const q = parseQuantity(r[bound]);
      if (!q.ok) errors.push(`${where}.${bound}: ${q.error}`);
      else req[bound] = { si: q.si, dim: q.dim };
    }
    if (!req.max && !req.min) errors.push(`${where}: max or min required`);
    requirements.push(req);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, design: { design, materialOverrides, nodes, edges, loadCases, requirements } };
}
