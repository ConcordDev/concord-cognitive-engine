// server/lib/conkay/cad/part-geometry.js
//
// SX-CAD-05 — cad.part-geometry: real geometry for every part of any
// system (catalogue wave 0, PRG-17). Target tier L3 instantiates
// parametric OCC templates for every part class via engine ticket
// SXE-06 — that engine is not built, so EVERY run carries the engine
// tier as NOT_COMPUTED engine_unavailable:sxe-06, never a fallback
// labelled as the engine result.
//
// Beside it, a LABELLED screening tier instantiates a declared
// template library in-process. The ticket's discipline — no part
// leaves without a solid, a volume, and a material slot — is the
// screening tier's output contract:
//
//   - every part record carries its exact analytic solid (volume +
//     area + centroid, from cad.mass-properties-brep's closed forms
//     via its exactSolid export — one home for the forms);
//   - every part record carries a material slot: the resolved
//     material/density source and a mass, OR an explicitly empty
//     slot (materialSlot null, massKg null, reason named) — a
//     material is never assumed to fill the slot;
//   - template parameters are bounded by TEMPLATE-DECLARED bounds
//     (the ticket's validity envelope): a parameter outside its
//     bound is out_of_envelope naming the parameter and the bound,
//     never silently clamped into range.
//
// Malformed input (unknown template, missing/non-finite parameter,
// duplicate id) refuses the whole run naming the indexed field — a
// BOM with a malformed line has no honest partial total.

import { registerSolver } from "../physics/registry.js";
import { exactSolid } from "./mass-properties-brep.js";
import { resolveMaterial } from "../material-library.js";

const NS = "cad.partGeometry";

// Template library: part class -> shape + per-parameter bounds in
// metres, (lower exclusive, upper inclusive]. The bounds are the
// templates' declared validity envelope.
export const TEMPLATES = {
  plate: { shape: "box", params: { length: [0, 10], width: [0, 10], height: [0, 10] } },
  shaft: { shape: "cylinder", params: { radius: [0, 2], height: [0, 20] } },
  ball: { shape: "sphere", params: { radius: [0, 5] } },
  pipe: { shape: "tube", params: { outerRadius: [0, 2], innerRadius: [0, 2], height: [0, 20] } },
};

const ENGINE_TIER = {
  requested: "L3",
  status: "NOT_COMPUTED",
  reason: "engine_unavailable:sxe-06",
  hint: "OCC parametric template engine (full part-class library, B-rep solids) is engine ticket SXE-06; the screening tier instantiates the declared analytic template library only",
};

/** The pure solver function. Exported for direct testing. */
export function partGeometry(props = {}) {
  const parts = props?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return { notComputed: "missing_input:parts", inputs: {} };
  }
  const seen = new Set();
  const records = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || typeof part.id !== "string" || !part.id) {
      return { notComputed: `INVALID_INPUT: parts[${i}].id must be a non-empty string`, inputs: {} };
    }
    if (seen.has(part.id)) {
      return { notComputed: `INVALID_INPUT: parts[${i}].id duplicates "${part.id}"`, inputs: {} };
    }
    seen.add(part.id);
    const tpl = TEMPLATES[part.template];
    if (!tpl) {
      return {
        notComputed: `unknown_template: parts[${i}].template "${part.template}" is not in the template library (${Object.keys(TEMPLATES).join(", ")})`,
        inputs: {},
      };
    }
    const params = part.params || {};
    const dims = {};
    for (const [name, [lo, hi]] of Object.entries(tpl.params)) {
      const v = params[name];
      if (v == null) {
        return { notComputed: `missing_input:parts[${i}].params.${name}`, inputs: {} };
      }
      const n = Number(v);
      if (!Number.isFinite(n) || Math.abs(n) >= 1e300) {
        return { notComputed: `INVALID_INPUT: parts[${i}].params.${name} must be a finite number`, inputs: {} };
      }
      if (!(n > lo && n <= hi)) {
        return {
          notComputed: `out_of_envelope: parts[${i}].params.${name} ${n} is outside the ${part.template} template's declared bound (${lo}, ${hi}] m`,
          inputs: {},
        };
      }
      dims[name] = n;
    }
    const got = exactSolid(tpl.shape, dims);
    if (got.error) {
      return { notComputed: `INVALID_INPUT: parts[${i}] ${got.error}`, inputs: {} };
    }
    // The material slot: resolved and named, or explicitly empty.
    let materialSlot = null;
    let massKg = null;
    let materialNote = null;
    if (part.densityKgM3 != null) {
      const d = Number(part.densityKgM3);
      if (!Number.isFinite(d) || d <= 0 || Math.abs(d) >= 1e300) {
        return { notComputed: `INVALID_INPUT: parts[${i}].densityKgM3 must be a positive finite number`, inputs: {} };
      }
      materialSlot = "declared input densityKgM3";
      massKg = got.solid.volumeM3 * d;
    } else if (part.material != null) {
      const m = resolveMaterial(part.material);
      if (m && Number.isFinite(m.densityKgM3)) {
        materialSlot = `material library: ${m.id}`;
        massKg = got.solid.volumeM3 * m.densityKgM3;
      } else {
        materialNote = `material "${part.material}" is not in the material library and no densityKgM3 was declared — slot left empty, no mass`;
      }
    } else {
      materialNote = "no material or density declared — slot left empty, no mass";
    }
    records.push({
      id: part.id,
      template: part.template,
      shape: tpl.shape,
      dims,
      volumeM3: got.solid.volumeM3,
      areaM2: got.solid.areaM2,
      centroidM: got.solid.centroidM,
      materialSlot,
      massKg,
      ...(materialNote ? { materialNote } : {}),
    });
  }
  const withMass = records.filter((r) => r.massKg != null);
  return {
    inputs: { parts },
    outputs: {
      engineTier: ENGINE_TIER,
      screening: true,
      screeningTier: "analytic-template-library",
      templates: Object.keys(TEMPLATES),
      parts: records,
      partCount: records.length,
      totalVolumeM3: records.reduce((s, r) => s + r.volumeM3, 0),
      totalMassKg: withMass.length ? withMass.reduce((s, r) => s + r.massKg, 0) : null,
      massCoverage: { withMass: withMass.length, withoutMass: records.length - withMass.length },
    },
    assumptions: [],
    warnings: [
      `engine tier L3 NOT_COMPUTED: ${ENGINE_TIER.reason} (screening template instantiation reported beside it, labelled)`,
      ...records.filter((r) => r.materialNote).map((r) => `part ${r.id}: ${r.materialNote}`),
    ],
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function pgTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function pgRun(ctx, id) {
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
  return partGeometry(props);
}

registerSolver({
  id: "cad.part-geometry",
  version: "1.0.0",
  domain: "cad",
  domains: ["cad"],
  method: "part-geometry.template-instantiate",
  fidelity: 3,
  engineDependent: ["sxe-06"],
  regime: "parts instantiable from the declared template library (plate/shaft/ball/pipe) within template-declared parameter bounds; the full OCC part-class library is the engine tier (SXE-06)",
  units: "template parameters in metres (SI), echoed as submitted; volumes m^3, areas m^2, masses kg",
  tolerance: "volumes and areas are the exact closed forms (relative error at float precision); parameter bounds are exact comparisons",
  screening: false,
  reference: "closed-form solid geometry (same forms as cad.mass-properties-brep); reference case (unit cube volume exact; every BOM line carries a solid) in server/tests/conkay-cad-part-geometry.test.js",
  graphProp: NS,
  targets: pgTargets,
  run: pgRun,
});

export default { partGeometry, TEMPLATES };
