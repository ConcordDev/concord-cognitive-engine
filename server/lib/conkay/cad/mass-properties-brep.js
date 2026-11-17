// server/lib/conkay/cad/mass-properties-brep.js
//
// SX-CAD-03 — cad.mass-properties-brep: exact mass properties (catalogue
// wave 0, PRG-17). Volume, surface area, mass, centroid and the inertia
// tensor from the exact integrals on analytic B-rep solids — box,
// cylinder, sphere, tube — in closed form. No tessellation anywhere in
// this tier: a shape outside the analytic set is NOT_COMPUTED naming the
// OCC kernel path (cad/body-kernel.js / occ-bridge), never a mesh
// approximation labelled exact. (The mesh tier exists separately:
// lib/asset-gen/mass-properties.js, tetrahedron decomposition — it is
// the screening shape, not this solver.)
//
// Inputs (props["cad.massProperties"]):
//   { shape, dims, material?, densityKgM3? }
//   box:      dims {length, width, height}   (x, y, z extents, metres)
//   cylinder: dims {radius, height}          (axis = z, origin at base centre)
//   sphere:   dims {radius}                  (origin at centre)
//   tube:     dims {outerRadius, innerRadius, height}
// Density: an explicit densityKgM3 wins; otherwise the material id is
// resolved in material-library.js. Neither -> NOT_COMPUTED naming the
// missing input. No density is ever assumed.
//
// Validation: every dimension must be a positive finite number;
// violations return NOT_COMPUTED with an INVALID_INPUT reason naming
// the field. Inertia is reported about the centroid, principal axes,
// products zero by symmetry and reported as computed zeros.

import { registerSolver } from "../physics/registry.js";
import { resolveMaterial } from "../material-library.js";

const NS = "cad.massProperties";
const SHAPES = ["box", "cylinder", "sphere", "tube"];

function invalid(field, why) {
  return { notComputed: `INVALID_INPUT: ${field} ${why}`, inputs: {} };
}

function dim(props, field) {
  const v = props?.dims?.[field];
  if (v == null) return { error: `missing_input:dims.${field}` };
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) >= 1e300) return { error: `INVALID_INPUT: dims.${field} must be a finite number` };
  if (n <= 0) return { error: `INVALID_INPUT: dims.${field} must be positive (got ${n})` };
  return { value: n };
}

function densityOf(props) {
  if (props?.densityKgM3 != null) {
    const n = Number(props.densityKgM3);
    if (!Number.isFinite(n) || n <= 0 || Math.abs(n) >= 1e300) {
      return { error: "INVALID_INPUT: densityKgM3 must be a positive finite number" };
    }
    return { density: n, source: "declared input densityKgM3" };
  }
  if (props?.material != null) {
    const m = resolveMaterial(props.material);
    if (!m || !Number.isFinite(m.densityKgM3)) {
      return { error: `NOT_COMPUTED: material "${props.material}" is not in the material library and no densityKgM3 was declared` };
    }
    return { density: m.densityKgM3, source: `material library: ${m.id}` };
  }
  return { error: "missing_input:densityKgM3 (or material)" };
}

const SOLIDS = {
  box(d) {
    const V = d.length * d.width * d.height;
    return {
      volumeM3: V,
      areaM2: 2 * (d.length * d.width + d.length * d.height + d.width * d.height),
      centroidM: [0, 0, 0],
      inertia: (m) => ({
        Ixx: (m / 12) * (d.width ** 2 + d.height ** 2),
        Iyy: (m / 12) * (d.length ** 2 + d.height ** 2),
        Izz: (m / 12) * (d.length ** 2 + d.width ** 2),
        Ixy: 0, Ixz: 0, Iyz: 0,
      }),
    };
  },
  cylinder(d) {
    const V = Math.PI * d.radius ** 2 * d.height;
    return {
      volumeM3: V,
      areaM2: 2 * Math.PI * d.radius * (d.radius + d.height),
      centroidM: [0, 0, d.height / 2],
      inertia: (m) => ({
        Ixx: (m / 12) * (3 * d.radius ** 2 + d.height ** 2),
        Iyy: (m / 12) * (3 * d.radius ** 2 + d.height ** 2),
        Izz: 0.5 * m * d.radius ** 2,
        Ixy: 0, Ixz: 0, Iyz: 0,
      }),
    };
  },
  sphere(d) {
    const V = (4 / 3) * Math.PI * d.radius ** 3;
    return {
      volumeM3: V,
      areaM2: 4 * Math.PI * d.radius ** 2,
      centroidM: [0, 0, 0],
      inertia: (m) => {
        const I = 0.4 * m * d.radius ** 2;
        return { Ixx: I, Iyy: I, Izz: I, Ixy: 0, Ixz: 0, Iyz: 0 };
      },
    };
  },
  tube(d) {
    const V = Math.PI * (d.outerRadius ** 2 - d.innerRadius ** 2) * d.height;
    return {
      volumeM3: V,
      areaM2:
        2 * Math.PI * (d.outerRadius + d.innerRadius) * d.height +
        2 * Math.PI * (d.outerRadius ** 2 - d.innerRadius ** 2),
      centroidM: [0, 0, d.height / 2],
      inertia: (m) => ({
        Ixx: (m / 12) * (3 * (d.outerRadius ** 2 + d.innerRadius ** 2) + d.height ** 2),
        Iyy: (m / 12) * (3 * (d.outerRadius ** 2 + d.innerRadius ** 2) + d.height ** 2),
        Izz: 0.5 * m * (d.outerRadius ** 2 + d.innerRadius ** 2),
        Ixy: 0, Ixz: 0, Iyz: 0,
      }),
    };
  },
};

const DIMS_FOR = {
  box: ["length", "width", "height"],
  cylinder: ["radius", "height"],
  sphere: ["radius"],
  tube: ["outerRadius", "innerRadius", "height"],
};

/**
 * The exact analytic solid for a shape + dims, without any density or
 * mass: { volumeM3, areaM2, centroidM, inertia(m) }. Shared with
 * cad.part-geometry (SX-CAD-05) so the closed forms live in exactly
 * one place. Returns { error } with the same strings the solver's own
 * validation produces.
 */
export function exactSolid(shape, dims = {}) {
  if (!SHAPES.includes(shape)) {
    return { error: `shape_not_in_exact_set: "${shape}" — the exact tier covers ${SHAPES.join(", ")}` };
  }
  const d = {};
  for (const f of DIMS_FOR[shape]) {
    const r = dim({ dims }, f);
    if (r.error) return { error: r.error };
    d[f] = r.value;
  }
  if (shape === "tube" && d.innerRadius >= d.outerRadius) {
    return { error: "INVALID_INPUT: dims.innerRadius must be smaller than dims.outerRadius" };
  }
  return { solid: SOLIDS[shape](d), dims: d };
}

/** The pure solver function. Exported for direct testing. */
export function massPropertiesBrep(props = {}) {
  const shape = props?.shape;
  if (typeof shape !== "string" || !shape) {
    return { notComputed: "missing_input:shape", inputs: {} };
  }
  if (!SHAPES.includes(shape)) {
    return {
      notComputed: `shape_not_in_exact_set: "${shape}" — the exact tier covers ${SHAPES.join(", ")}; freeform B-rep mass properties need the OCC kernel path (cad/body-kernel.js), and no mesh approximation is labelled exact`,
      inputs: { shape },
    };
  }
  const dims = {};
  for (const f of DIMS_FOR[shape]) {
    const r = dim(props, f);
    if (r.error) return { notComputed: r.error, inputs: { shape } };
    dims[f] = r.value;
  }
  if (shape === "tube" && dims.innerRadius >= dims.outerRadius) {
    return invalid("dims.innerRadius", "must be smaller than dims.outerRadius");
  }
  const dens = densityOf(props);
  if (dens.error) return { notComputed: dens.error, inputs: { shape, dims } };

  const solid = SOLIDS[shape](dims);
  const massKg = solid.volumeM3 * dens.density;
  return {
    inputs: { shape, dims, densityKgM3: dens.density },
    outputs: {
      shape,
      volumeM3: solid.volumeM3,
      areaM2: solid.areaM2,
      massKg,
      centroidM: solid.centroidM,
      inertiaKgM2: solid.inertia(massKg),
      densitySource: dens.source,
    },
    assumptions: [],
    warnings: [],
  };
}

// Local targets/run pair (same literal-key discipline as orc.intent-parse;
// graph-adapter's halves disagree at this build — finding filed under
// SX-ORC-01).
function cadTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function cadRun(ctx, id) {
  let all = null;
  try {
    all = ctx.get(id, "props");
  } catch {
    all = null;
  }
  const props = all ? all[NS] : null;
  if (!props || (typeof props === "object" && !Array.isArray(props) && Object.keys(props).length === 0)) {
    return { notComputed: `props.${NS} is empty or absent on node ${id}`, inputs: {} };
  }
  return massPropertiesBrep(props);
}

registerSolver({
  id: "cad.mass-properties-brep",
  version: "1.0.0",
  domain: "cad",
  domains: ["cad"],
  method: "mass-properties.brep-exact",
  fidelity: 2,
  regime: "analytic solids (box, cylinder, sphere, tube) with positive finite dimensions; freeform B-rep is out of this tier by design",
  units: "SI: metres, kg/m3, kg, kg m2; inputs echoed exactly as submitted",
  tolerance: "closed-form exact; reference cases asserted to 1e-9 relative",
  screening: false,
  reference: "standard rigid-body closed forms (cube I = m a^2 / 6; cylinder I_axis = m r^2 / 2; sphere I = 2 m r^2 / 5); cases in server/tests/conkay-cad-mass-properties.test.js",
  graphProp: NS,
  targets: cadTargets,
  run: cadRun,
});

export default { massPropertiesBrep };
