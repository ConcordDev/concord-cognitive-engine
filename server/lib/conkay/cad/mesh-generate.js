// server/lib/conkay/cad/mesh-generate.js
//
// SX-CAD-01 — mesh.generate: meshing for FE/FV (catalogue wave 0,
// PRG-17). Target tier L3 is engine-bound (gmsh = SXE-06, Netgen =
// SXE-11; neither engine is installed at this build, and both sit in
// the queued engine wave). The wave-0 shape, per the catalogue's
// honesty rules:
//
//   - the L3 engine tier answers NOT_COMPUTED
//     engine_unavailable:sxe-06 / engine_unavailable:sxe-11 with an
//     install hint — never a quiet downgrade;
//   - beside it, a LABELLED screening tier (screening: true) computes a
//     real structured hex mesh for box geometry in-process, with the
//     quality metrics the gmsh/Netgen documentation names (cell count,
//     node count, min/max cell volume, max aspect ratio);
//   - a non-box shape has no screening path: the whole result is the
//     engine tier's NOT_COMPUTED.
//
// When SXE-06 / SXE-11 land on the SXE-00 engine framework, the engine
// tier arms inside this solver's run(); the screening tier stays as the
// labelled fast path (solver.select wiring rides SX-XC-01).
//
// Inputs (props["cad.mesh"]):
//   { shape: "box", dims {length, width, height},
//     divisions {nx, ny, nz} | targetSizeM }
// Quality envelope (declared): screening aspect ratio <= 20; a mesh
// past it is returned with the violation named in warnings (WARN), not
// silently accepted. Division caps: 512 per axis, 2,000,000 cells —
// past the cap the request is out of envelope and NOT_COMPUTED names it.

import { registerSolver } from "../physics/registry.js";

const NS = "cad.mesh";
const MAX_AXIS_DIVISIONS = 512;
const MAX_CELLS = 2_000_000;
const ASPECT_LIMIT = 20;

const ENGINE_REASON =
  "engine_unavailable:sxe-06 (gmsh), engine_unavailable:sxe-11 (netgen) — install via the engine CI lane (SXE-06/SXE-11)";

function dim(props, field) {
  const v = props?.dims?.[field];
  if (v == null) return { error: `missing_input:dims.${field}` };
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) >= 1e300) return { error: `INVALID_INPUT: dims.${field} must be a finite number` };
  if (n <= 0) return { error: `INVALID_INPUT: dims.${field} must be positive (got ${n})` };
  return { value: n };
}

function divisionsFor(props, dims) {
  if (props?.divisions != null) {
    const out = {};
    for (const axis of ["nx", "ny", "nz"]) {
      const v = props.divisions[axis];
      if (v == null) return { error: `missing_input:divisions.${axis}` };
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) return { error: `INVALID_INPUT: divisions.${axis} must be a positive integer` };
      if (n > MAX_AXIS_DIVISIONS) return { error: `mesh_out_of_envelope: divisions.${axis} ${n} exceeds the screening cap of ${MAX_AXIS_DIVISIONS}` };
      out[axis] = n;
    }
    return out;
  }
  if (props?.targetSizeM != null) {
    const t = Number(props.targetSizeM);
    if (!Number.isFinite(t) || t <= 0) return { error: "INVALID_INPUT: targetSizeM must be a positive finite number" };
    const out = {
      nx: Math.max(1, Math.ceil(dims.length / t)),
      ny: Math.max(1, Math.ceil(dims.width / t)),
      nz: Math.max(1, Math.ceil(dims.height / t)),
    };
    for (const axis of ["nx", "ny", "nz"]) {
      if (out[axis] > MAX_AXIS_DIVISIONS) return { error: `mesh_out_of_envelope: targetSizeM implies divisions.${axis} ${out[axis]}, over the screening cap of ${MAX_AXIS_DIVISIONS}` };
    }
    return out;
  }
  return { error: "missing_input:divisions (or targetSizeM)" };
}

/** The pure solver function. Exported for direct testing. */
export function meshGenerate(props = {}) {
  const shape = props?.shape;
  if (typeof shape !== "string" || !shape) {
    return { notComputed: "missing_input:shape", inputs: {} };
  }
  if (shape !== "box") {
    return {
      notComputed: `NOT_COMPUTED ${ENGINE_REASON}; shape "${shape}" has no in-process screening mesh`,
      inputs: { shape },
    };
  }
  const dims = {};
  for (const f of ["length", "width", "height"]) {
    const r = dim(props, f);
    if (r.error) return { notComputed: r.error, inputs: { shape } };
    dims[f] = r.value;
  }
  const div = divisionsFor(props, dims);
  if (div.error) return { notComputed: div.error, inputs: { shape, dims } };

  const cells = div.nx * div.ny * div.nz;
  if (cells > MAX_CELLS) {
    return {
      notComputed: `mesh_out_of_envelope: ${cells} cells exceeds the screening cap of ${MAX_CELLS}`,
      inputs: { shape, dims, divisions: div },
    };
  }
  const cell = { x: dims.length / div.nx, y: dims.width / div.ny, z: dims.height / div.nz };
  const cellVolume = cell.x * cell.y * cell.z;
  const edges = [cell.x, cell.y, cell.z];
  const aspect = Math.max(...edges) / Math.min(...edges);
  const warnings = [
    `top tier L3 not computed: ${ENGINE_REASON}`,
  ];
  if (aspect > ASPECT_LIMIT) {
    warnings.push(`quality violation: max aspect ratio ${aspect.toFixed(3)} exceeds the declared screening limit of ${ASPECT_LIMIT}`);
  }

  return {
    inputs: { shape, dims, divisions: div },
    outputs: {
      tier: "screening-structured",
      screening: true,
      shape,
      nodes: (div.nx + 1) * (div.ny + 1) * (div.nz + 1),
      cells,
      cellDimsM: cell,
      minCellVolumeM3: cellVolume,
      maxCellVolumeM3: cellVolume,
      maxAspectRatio: aspect,
      quality: { aspectLimit: ASPECT_LIMIT, withinThresholds: aspect <= ASPECT_LIMIT },
      engineTier: { requested: "L3", status: "NOT_COMPUTED", reason: ENGINE_REASON },
    },
    assumptions: [],
    warnings,
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function meshTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function meshRun(ctx, id) {
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
  return meshGenerate(props);
}

registerSolver({
  id: "mesh.generate",
  version: "1.0.0",
  domain: "cad",
  domains: ["cad"],
  method: "mesh.generate",
  fidelity: 3,
  regime: "L3 engine tier: OCC STEP solids via gmsh/Netgen (SXE-06/SXE-11). Screening tier: box geometry, structured hex, aspect <= 20, <= 512 divisions per axis, <= 2,000,000 cells",
  units: "SI: metres; mesh counts are dimensionless integers",
  tolerance: "screening counts and volumes are exact integers/rationals of the inputs; engine-tier quality thresholds per gmsh/Netgen documentation when armed",
  screening: false,
  reference: "gmsh / Netgen documentation (mesh quality metrics); reference case in server/tests/conkay-cad-mesh-generate.test.js",
  engineDependent: ["sxe-06", "sxe-11"],
  graphProp: NS,
  targets: meshTargets,
  run: meshRun,
});

export default { meshGenerate };
