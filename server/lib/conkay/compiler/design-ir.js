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
//   nodes:        [{ id, kind, name?, material?, geometry?: { shape, ...quantities }, position?: { x, y, z }, props? }]
//                 position is the part's centroid in the design frame (vehicles: x increases toward the rear)
//   edges:        [{ type, from, to, props? }]
//   loadCases:    [{ id, label?, loads: [{ target, shear?, tension?, pointLoad?, compression? }] }]
//   requirements: [{ id, label, of: { solver, target, output }, max?: q, min?: q }]
// }

import { parseQuantity } from "./units.js";
import { getMaterial } from "../materials/index.js";
import { validateMassState } from "../verification/mass-state.js";
import { CAD_BODY_OPTIONAL } from "../cad/body-params.js";
import { nullDict, ownArray, ownValue } from "../../own-lookup.js";
import { validateBoltJointInputs } from "./bolt-joint-inputs-validator.js";

export const NODE_KINDS = new Set([
  "Part", "Assembly", "Volume", "Surface", "Beam", "Shell", "Solid", "Joint", "Constraint", "Load",
  "Field", "Material", "Fluid", "Circuit", "Actuator", "Sensor", "HeatSource", "HeatSink", "Boundary",
  "Interface", "Process",
  // Common specializations of Part.
  "Bolt", "Plate", "Tire", "Seat",
  // People and cargo: they have mass (gross mass, CG) but are not part of
  // the product's own (kerb) mass or cost.
  "Payload",
  // Safety case (lib/conkay/safety-case): functions → trains → components → supports.
  "SafetyCase", "SafetyFunction", "SafetyTrain", "SafetyComponent", "SupportItem",
]);

// Kinds with no body of their own. Every other kind is physical: it needs
// geometry before it has a mass, and an assembly can't be weighed without it.
export const LOGICAL_KINDS = new Set(["Assembly", "Joint", "Constraint", "Load", "Field", "Material", "Boundary", "Interface", "Process"]);

export const EDGE_TYPES = new Set([
  "BOLTED_TO", "WELDED_TO", "MATED_TO", "CONSTRAINS", "LOADS", "SUPPORTS", "CONDUCTS", "CONTAINS",
  "THERMALLY_COUPLED_TO", "FLUID_CONNECTED_TO", "ELECTRICALLY_CONNECTED_TO", "MANUFACTURED_BY", "DEPENDS_ON",
]);

// Geometry shapes and the length parameters each one needs.
// Null prototype so a caller-supplied shape of "constructor" is an
// unknown shape, not Object.prototype.constructor (which is not iterable).
export const SHAPES = nullDict({
  box: ["length", "width", "height"],
  plate: ["length", "width", "thickness"],
  cylinder: ["diameter", "length"],
  rod: ["diameter", "length"],
  bolt: ["diameter", "length"],
  "i-beam": ["length", "height", "flangeWidth", "flangeThickness", "webThickness"],
  // A panel or laminate: mass from area × thickness (no AABB, no solid block).
  shell: ["area", "thickness"],
  // Rectangular hollow section (square/rect tube): outside width × height,
  // uniform wall, sharp corners (corner radii not modelled).
  "rect-tube": ["length", "width", "height", "wall"],
  // A closed body skin approximated as an ellipsoid of the given overall
  // length × width × height: area, mass and frontal area come from these.
  "ellipsoid-shell": ["length", "width", "height", "thickness"],
  // The CAD body (cad.body): a B-spline skin solved around the vehicle's
  // packaging envelopes; area, volume, frontal area come from the kernel.
  "cad-body": ["thickness", "skinOffset"],
});

// Optional shape parameters: lengths (with units) and plain numbers.
export const SHAPE_OPTIONAL = nullDict({ "cad-body": CAD_BODY_OPTIONAL });

// Shape parameters are lengths unless listed here.
export const PARAM_DIM = { area: "area" };
export const paramDim = (key) => PARAM_DIM[key] || "length";

// shear/tension act on joints; pointLoad (midspan, or the tip of a
// cantilever) and compression (axial) act on beams.
const LOAD_KEYS = { shear: "force", tension: "force", pointLoad: "force", compression: "force" };

// Node props that carry a unit; converted to SI like geometry. Other props
// are passed through as plain values.
// mass and unitCost are stated values (a datasheet, a catalogue, an
// assumption) and must say where they come from: massSource /
// unitCostSource are required alongside them.
export const TYPED_PROPS = { maxPower: "power", mass: "mass", unitCost: "money" };

// Joint-node props that carry a unit. These are length quantities (SI
// metres after compilation). Joint.props.shearPlanes and threadsExcluded
// remain plain values — they're integers/booleans, not physical quantities.
// The bolt-tearout solver needs edgeDistance and holeDiameter to apply
// AISC 360-16 §J3.10c (Eq. J3-6c). Without these, the solver returns
// notComputed with a structured reason — never a fabricated default.
//
// holePattern: array of {x, y} in the joint's local frame (SI metres
// after compile). The array length must equal the number of Bolt
// children, OR a single holePattern entry with no matching bolts is
// permitted (the compiler does not enforce count equality — that's the
// joint solvers' job, because some joints (e.g. plug welds) describe
// holes without per-bolt coords). Each entry is unit-checked: x and y
// must be positive lengths. The schema validator enforces this.
//
// Note: edgeDistance and edgeDistancePerpendicular are still the
// user-supplied edge distances for the OUTER bolts; holePattern is
// the per-bolt coordinates of every hole (used by net-section, block-
// shear, and bolt-group-distribution). The two are complementary, not
// redundant.
export const TYPED_JOINT_PROPS = {
  edgeDistance: "length",   // L_e: hole center to plate edge, parallel to load (J3-10c)
  holeDiameter: "length",   // d_h: nominal hole diameter (typically d_bolt + 1/16" per AISC §J3.3)
  edgeDistancePerpendicular: "length", // L_e perp to load (used by block-shear §J4-3)
  spacing: "length",        // center-to-center bolt spacing (along load direction)
  spacingPerpendicular: "length", // center-to-center bolt spacing (perp to load)
  flangeThickness: "length",  // T-stub flange thickness (prying-action, AISC §9)
  tStubA: "length",           // T-stub: distance from bolt centerline to face of stem
  tStubB: "length",           // T-stub: distance from bolt centerline to edge of flange
  tributaryWidth: "length",   // T-stub: per-bolt tributary flange width w
  // jointFayingSurface: a class string ("A" | "B" | "C") is plain text, not a quantity.
};

// Bolt-node props that carry a unit. Currently:
//   stressArea: the bolt's tensile stress area (Ab, AISC Manual Table 7-2).
//     Area in SI (m²) after compilation. The joint.bolt-tension solver
//     needs this to apply AISC 360-16 §J3.6 (φRn = 0.75·Fnt·Ab).
//   pretension: the minimum specified bolt pretension Tb (AISC Table J3.1).
//     Force in SI (N) after compilation. The joint.slip-critical solver
//     needs this for the friction capacity.
export const TYPED_BOLT_PROPS = {
  stressArea: "area",
  pretension: "force",
};

// Plate-node props that carry a unit. Currently:
//   grossArea: the cross-sectional area of the plate (Ag in AISC §D2-1).
//     For a rectangular plate, this is computed from width × thickness.
//     For non-rectangular sections (C-shapes, angles, hollow sections,
//     built-up sections), the user supplies the value here and the
//     joint.gross-section solver uses it instead of geometry. Area in
//     SI (m²) after compilation.
export const TYPED_PLATE_PROPS = {
  grossArea: "area",
  netAreaEffective: "area",  // Ae (effective net area) — used by net-section
};
// The holePattern prop is a list of {x, y} coords. Element-level
// quantities are handled by the IR compiler (each x and y is a length),
// so the prop itself doesn't appear in TYPED_JOINT_PROPS — it's a
// compound field validated by the schema validator.
const SOURCED_PROPS = { mass: "massSource", unitCost: "unitCostSource" };
const TYPED_VEHICLE_PROPS = { frontalArea: "area", airDensity: "density", frontAxleX: "length", rearAxleX: "length", tireRadius: "length" };

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
    const node = { id, kind: n.kind, name: String(n.name || id), material: null, geometry: null, position: null, props: { ...(n.props || {}) } };
    if (n.position != null) {
      const pos = {};
      for (const axis of ["x", "y", "z"]) {
        const q = parseQuantity(n.position[axis], "length");
        if (!q.ok) errors.push(`${where}.position.${axis}: ${q.error}`);
        else pos[axis] = q.si;
      }
      node.position = pos;
    }
    for (const [k, dim] of Object.entries(TYPED_PROPS)) {
      if (node.props[k] == null) continue;
      const q = parseQuantity(node.props[k], dim);
      if (!q.ok) errors.push(`${where}.props.${k}: ${q.error}`);
      else if (q.si <= 0) errors.push(`${where}.props.${k}: must be positive`);
      else node.props[k] = q.si;
    }
    // Joint-only unit-aware props. The compiler does not invent defaults;
    // a Joint without these keeps the prop undefined so downstream
    // solvers can return notComputed with a precise reason.
    if (node.kind === "Joint") {
      for (const [k, dim] of Object.entries(TYPED_JOINT_PROPS)) {
        if (node.props[k] == null) continue;
        const q = parseQuantity(node.props[k], dim);
        if (!q.ok) errors.push(`${where}.props.${k}: ${q.error}`);
        else if (q.si <= 0) errors.push(`${where}.props.${k}: must be positive`);
        else node.props[k] = q.si;
      }
      // Edge distance is bounded below by half the hole diameter
      // (otherwise the "clear distance" Lc is negative). The compiler
      // reports a precise reason rather than silently truncating.
      if (Number.isFinite(node.props.edgeDistance) && Number.isFinite(node.props.holeDiameter) && node.props.edgeDistance <= node.props.holeDiameter / 2) {
        errors.push(`${where}: props.edgeDistance (${node.props.edgeDistance} m) must exceed half of props.holeDiameter (${node.props.holeDiameter} m); otherwise the clear distance is negative`);
      }
      // holePattern: array of {x, y} in the joint's local frame. Each
      // entry is unit-converted individually; the array length is NOT
      // enforced here (solver responsibility). Entries must be objects
      // with non-negative x and y lengths (x=0 or y=0 is valid: a hole
      // on the joint's reference axis is a normal case for a centered
      // bolt group; only negative coordinates are rejected, because
      // those would mean a hole outside the plate's local frame).
      if (node.props.holePattern != null) {
        if (!Array.isArray(node.props.holePattern)) {
          errors.push(`${where}.props.holePattern: must be an array of {x, y} coordinate pairs`);
        } else {
          const out = [];
          for (let i = 0; i < node.props.holePattern.length; i++) {
            const entry = node.props.holePattern[i];
            if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
              errors.push(`${where}.props.holePattern[${i}]: must be an object with x and y lengths`);
              out.push(null);
              continue;
            }
            const xq = parseQuantity(entry.x, "length");
            const yq = parseQuantity(entry.y, "length");
            if (!xq.ok) { errors.push(`${where}.props.holePattern[${i}].x: ${xq.error}`); out.push(null); continue; }
            if (!yq.ok) { errors.push(`${where}.props.holePattern[${i}].y: ${yq.error}`); out.push(null); continue; }
            if (xq.si < 0) { errors.push(`${where}.props.holePattern[${i}].x: must be non-negative (got ${xq.si} m)`); out.push(null); continue; }
            if (yq.si < 0) { errors.push(`${where}.props.holePattern[${i}].y: must be non-negative (got ${yq.si} m)`); out.push(null); continue; }
            out.push({ x: xq.si, y: yq.si });
          }
          node.props.holePattern = out;
        }
      }
      // eccentricity: a 2D vector {x, y} (length, m) of the load
      // application point relative to the bolt-group centroid. Used
      // by joint.bolt-group-distribution to compute the moment M.
      if (node.props.eccentricity != null) {
        if (typeof node.props.eccentricity !== "object" || Array.isArray(node.props.eccentricity)) {
          errors.push(`${where}.props.eccentricity: must be an object with x and y lengths`);
        } else {
          const exq = parseQuantity(node.props.eccentricity.x, "length");
          const eyq = parseQuantity(node.props.eccentricity.y, "length");
          if (!exq.ok) errors.push(`${where}.props.eccentricity.x: ${exq.error}`);
          else if (!eyq.ok) errors.push(`${where}.props.eccentricity.y: ${eyq.error}`);
          else node.props.eccentricity = { x: exq.si, y: eyq.si };
        }
      }
    }
    if (node.kind === "Bolt") {
      for (const [k, dim] of Object.entries(TYPED_BOLT_PROPS)) {
        if (node.props[k] == null) continue;
        const q = parseQuantity(node.props[k], dim);
        if (!q.ok) errors.push(`${where}.props.${k}: ${q.error}`);
        else if (q.si <= 0) errors.push(`${where}.props.${k}: must be positive`);
        else node.props[k] = q.si;
      }
    }
    if (node.kind === "Plate") {
      for (const [k, dim] of Object.entries(TYPED_PLATE_PROPS)) {
        if (node.props[k] == null) continue;
        const q = parseQuantity(node.props[k], dim);
        if (!q.ok) errors.push(`${where}.props.${k}: ${q.error}`);
        else if (q.si <= 0) errors.push(`${where}.props.${k}: must be positive`);
        else node.props[k] = q.si;
      }
    }
    for (const [k, srcKey] of Object.entries(SOURCED_PROPS)) {
      // A stated mass can say where it comes from with a massState instead.
      if (k === "mass" && n.props?.massState != null) continue;
      if (n.props?.[k] != null && !(typeof n.props?.[srcKey] === "string" && n.props[srcKey].trim())) {
        errors.push(`${where}.props.${k}: a stated ${k} needs props.${srcKey} (datasheet, catalogue or assumption)`);
      }
    }
    // massState: where a mass comes from (sourced / estimated / computed / placeholder),
    // with the fields each state requires. A computed state belongs to a part
    // whose mass comes from its geometry; a stated mass is never "computed".
    if (n.props?.massState != null) {
      const ms = n.props.massState;
      const massKg = typeof node.props.mass === "number" ? node.props.mass : undefined;
      for (const e of validateMassState(ms, { massKg })) errors.push(`${where}.props.massState: ${e}`);
      if (ms?.state === "computed" && n.props?.mass != null) errors.push(`${where}.props.massState: a stated mass cannot be "computed"; give geometry and a material instead`);
      if (ms && ms.state !== "placeholder" && ms.state !== "computed" && n.props?.mass == null) errors.push(`${where}.props.massState: a ${ms.state} mass needs props.mass`);
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
      const shapeKeys = ownArray(SHAPES, shape);
      if (!shapeKeys) errors.push(`${where}: unknown shape "${shape}"`);
      else {
        const geometry = { shape };
        for (const key of shapeKeys) {
          const q = parseQuantity(n.geometry[key], paramDim(key));
          if (!q.ok) errors.push(`${where}.geometry.${key}: ${q.error}`);
          else if (q.si <= 0) errors.push(`${where}.geometry.${key}: must be positive`);
          else geometry[key] = q.si;
        }
        const opt = ownValue(SHAPE_OPTIONAL, shape);
        const optLengths = opt && Array.isArray(opt.lengths) ? opt.lengths : [];
        for (const key of optLengths) {
          if (n.geometry[key] == null) continue;
          const q = parseQuantity(n.geometry[key], "length");
          if (!q.ok) errors.push(`${where}.geometry.${key}: ${q.error}`);
          else if (q.si <= 0) errors.push(`${where}.geometry.${key}: must be positive`);
          else geometry[key] = q.si;
        }
        const optNumbers = opt && Array.isArray(opt.numbers) ? opt.numbers : [];
        for (const key of optNumbers) {
          if (n.geometry[key] == null) continue;
          const v = Number(n.geometry[key]);
          if (!Number.isFinite(v) || v <= 0) errors.push(`${where}.geometry.${key}: must be a positive number`);
          else geometry[key] = v;
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
  // Bolt-joint input validation. Runs *after* unit conversion so the
  // validator can check SI values, ranges, and inter-field constraints
  // (e.g. edgeDistance > holeDiameter/2). This is a non-mutating
  // structural check; it does not invent defaults. Absent fields stay
  // absent. Validation errors are appended to the compiler errors so
  // an invalid design fails to compile with a precise reason — never
  // silently degrades to a wrong answer.
  //
  // The validator runs on the *compiled* values (SI numbers, not
  // input strings). The compiler has already rejected unparseable
  // units and converted the rest.
  const vErrors = validateBoltJointInputs({
    nodes,
    edges,
    loadCases,
  });
  for (const e of vErrors) {
    errors.push(`${e.where}.${e.field}: [${e.code}] ${e.message}`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, design: { design, materialOverrides, nodes, edges, loadCases, requirements } };
}
