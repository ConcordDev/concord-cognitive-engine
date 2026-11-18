// server/lib/conkay/cad/assembly-constraints.js
//
// SX-CAD-06 — cad.assembly-constraints: assembly mates and constraint
// solving (catalogue wave 0, PRG-17). Target tier L3 is a 3-D
// geometric constraint solver (coincident/concentric/distance/angle/
// gear/slider) on OCC + the SolveSpace solver via engine ticket
// SXE-01 — that engine is not built, so EVERY run carries the engine
// tier as NOT_COMPUTED engine_unavailable:sxe-01, never a fallback
// labelled as the engine result. assembly-mates.js's kinematic mates
// stay as they are (their own honesty note stands); this solver does
// not replace them.
//
// Beside it, a LABELLED screening tier does assembly DOF accounting
// by the Grübler–Kutzbach criterion — the standard mobility count:
//
//   planar:  DOF = 3(n − 1) − Σ joint constraints
//            (revolute/prismatic remove 2, rolling contact removes 1)
//   spatial: DOF = 6(n − 1) − Σ joint constraints
//            (a joint with f freedoms removes 6 − f)
//
// with over-constraint detection: DOF < 0 names the assembly
// over-constrained BY COUNT, with the excess. The count is a
// criterion count, not a rank proof — special geometries (a
// parallelogram linkage with a redundant parallel link is the
// textbook case) can move at count 0 or jam at count 1; the outputs
// carry that caveat as dofNote, the same discipline as
// cad.parametric-features' dofByCount. Duplicate joints between the
// same link pair with the same type are named as redundancy
// candidates — a signal for review, not silently merged.

import { registerSolver } from "../physics/registry.js";

const NS = "cad.assemblyConstraints";

// Joint vocabularies by mechanism family: freedoms per joint type.
export const JOINTS = {
  planar: { revolute: 1, prismatic: 1, rolling: 2 },
  spatial: { revolute: 1, prismatic: 1, cylindrical: 2, spherical: 3, planar: 3, fixed: 0 },
};

const ENGINE_TIER = {
  requested: "L3",
  status: "NOT_COMPUTED",
  reason: "engine_unavailable:sxe-01",
  hint: "3-D geometric constraint solver (OCC + SolveSpace process) is engine ticket SXE-01; the screening tier reports Grübler-Kutzbach DOF accounting only",
};

/** The pure solver function. Exported for direct testing. */
export function assemblyConstraints(props = {}) {
  const mechanism = props?.mechanism;
  if (mechanism == null) {
    return { notComputed: "missing_input:mechanism", inputs: {} };
  }
  if (!(mechanism in JOINTS)) {
    return { notComputed: `INVALID_INPUT: mechanism "${mechanism}" is not one of ${Object.keys(JOINTS).join("/")}`, inputs: {} };
  }
  const links = props?.links;
  if (!Array.isArray(links) || links.length === 0) {
    return { notComputed: "missing_input:links", inputs: {} };
  }
  const ids = new Set();
  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    if (!l || typeof l.id !== "string" || !l.id) {
      return { notComputed: `INVALID_INPUT: links[${i}].id must be a non-empty string`, inputs: {} };
    }
    if (ids.has(l.id)) {
      return { notComputed: `INVALID_INPUT: links[${i}].id duplicates "${l.id}"`, inputs: {} };
    }
    ids.add(l.id);
  }
  const grounds = links.filter((l) => l.ground === true);
  if (grounds.length !== 1) {
    return {
      notComputed: `INVALID_INPUT: exactly one link must be marked ground (got ${grounds.length}) — the mobility count is relative to ground`,
      inputs: {},
    };
  }
  const joints = props?.joints === undefined ? [] : props.joints;
  if (!Array.isArray(joints)) {
    return { notComputed: "INVALID_INPUT: joints must be an array", inputs: {} };
  }
  const vocab = JOINTS[mechanism];
  const base = mechanism === "planar" ? 3 : 6;
  let constraintSum = 0;
  const seenPairs = new Map();
  const redundantCandidates = [];
  for (let i = 0; i < joints.length; i++) {
    const j = joints[i];
    if (!j || !(j.type in vocab)) {
      return {
        notComputed: `INVALID_INPUT: joints[${i}].type "${j?.type}" is not in the ${mechanism} vocabulary (${Object.keys(vocab).join(", ")})`,
        inputs: {},
      };
    }
    const pair = Array.isArray(j.links) ? j.links : [];
    if (pair.length !== 2 || pair[0] === pair[1]) {
      return { notComputed: `INVALID_INPUT: joints[${i}].links must name two distinct links`, inputs: {} };
    }
    for (const ref of pair) {
      if (!ids.has(ref)) {
        return { notComputed: `INVALID_INPUT: joints[${i}] references unknown link "${ref}"`, inputs: {} };
      }
    }
    constraintSum += base - vocab[j.type];
    const key = `${j.type}:${[...pair].sort().join("|")}`;
    if (seenPairs.has(key)) redundantCandidates.push({ joint: i, duplicates: seenPairs.get(key), type: j.type, links: pair });
    else seenPairs.set(key, i);
  }
  const dof = base * (links.length - 1) - constraintSum;
  const classification = dof > 0 ? "mechanism" : dof === 0 ? "structure-by-count" : "over-constrained-by-count";
  const warnings = [`engine tier L3 NOT_COMPUTED: ${ENGINE_TIER.reason} (screening DOF accounting reported beside it, labelled)`];
  if (dof < 0) warnings.push(`over-constrained by count: ${-dof} excess constraint(s) — the geometric tier (SXE-01) decides which are truly redundant`);
  if (redundantCandidates.length) warnings.push(`${redundantCandidates.length} duplicate joint(s) named in redundantCandidates — review for redundancy`);
  return {
    inputs: { mechanism, links, joints },
    outputs: {
      engineTier: ENGINE_TIER,
      screening: true,
      screeningTier: "gruebler-kutzbach-accounting",
      mechanism,
      linkCount: links.length,
      jointCount: joints.length,
      constraintSum,
      dof,
      classification,
      dofNote: "Grübler-Kutzbach criterion count, not a rank proof — special geometries (redundant parallel links, aligned axes) can move at count 0 or jam at count 1; the geometric tier decides",
      redundantCandidates,
    },
    assumptions: [],
    warnings,
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function acTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function acRun(ctx, id) {
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
  return assemblyConstraints(props);
}

registerSolver({
  id: "cad.assembly-constraints",
  version: "1.0.0",
  domain: "cad",
  domains: ["cad"],
  method: "assembly-constraints.gruebler-kutzbach",
  fidelity: 3,
  engineDependent: ["sxe-01"],
  regime: "rigid parts (the ticket's validity envelope); planar or spatial linkages with joints from the declared family vocabulary",
  units: "dimensionless accounting (link and joint counts); no quantities are introduced",
  tolerance: "exact integer accounting; the DOF is a criterion count with its special-geometry caveat carried in the outputs",
  screening: false,
  reference: "Grübler-Kutzbach mobility criterion (standard mechanism theory); reference case (4-bar DOF = 1) in server/tests/conkay-cad-assembly-constraints.test.js",
  graphProp: NS,
  targets: acTargets,
  run: acRun,
});

export default { assemblyConstraints, JOINTS };
