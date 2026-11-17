// server/lib/conkay/cad/parametric-features.js
//
// SX-CAD-02 — cad.parametric-features: parametric feature modeling
// (catalogue wave 0, PRG-17). Target tier L2 runs on the OCC kernel
// via engine ticket SXE-21 (features, configurations) — that engine
// is not built, so EVERY run carries the engine tier as
// NOT_COMPUTED engine_unavailable:sxe-21 with the install hint, never
// a fallback number labelled as the engine result.
//
// Beside it, a LABELLED screening tier does real work in-process: a
// 2D sketch-constraint solve over the vocabulary
//   fixed · coincident · horizontal · vertical · distance
// by deterministic relaxation (constraint projections applied in
// input order until the max residual is within the declared
// tolerance, or the sweep cap is hit and the solve reports
// solver_not_converged — a screening non-convergence is named, never
// papered over). Deterministic: same inputs, same sweeps, same
// solved points.
//
// DOF is reported BY COUNT (2 per point minus scalar constraint
// equations: fixed 2, coincident 2, distance/horizontal/vertical 1).
// A count is not a rank computation — dependent constraints can make
// the true DOF higher; the field is named dofByCount and the
// limitation is stated in the outputs, not hidden.

import { registerSolver } from "../physics/registry.js";

const NS = "cad.parametricFeatures";
const TOL = 1e-9; // declared acceptance tolerance on constraint residuals
const EPS = 1e-12; // internal convergence target: a guard band under TOL, so chained-constraint coordinate error stays well inside the declared tolerance
const MAX_SWEEPS = 10000;
const WEIGHTS = { fixed: 2, coincident: 2, distance: 1, horizontal: 1, vertical: 1 };

function residualOf(c, P) {
  const a = P.get(c.a);
  switch (c.type) {
    case "fixed": {
      const p = P.get(c.point);
      return Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y));
    }
    case "coincident": {
      const b = P.get(c.b);
      return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    }
    case "horizontal": return Math.abs(a.y - P.get(c.b).y);
    case "vertical": return Math.abs(a.x - P.get(c.b).x);
    case "distance": {
      const b = P.get(c.b);
      return Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - c.value);
    }
    default: return 0;
  }
}

function project(c, P) {
  switch (c.type) {
    case "fixed": {
      const p = P.get(c.point);
      p.x = c.x; p.y = c.y;
      break;
    }
    case "coincident": {
      const a = P.get(c.a), b = P.get(c.b);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      a.x = mx; a.y = my; b.x = mx; b.y = my;
      break;
    }
    case "horizontal": {
      const a = P.get(c.a), b = P.get(c.b);
      const my = (a.y + b.y) / 2;
      a.y = my; b.y = my;
      break;
    }
    case "vertical": {
      const a = P.get(c.a), b = P.get(c.b);
      const mx = (a.x + b.x) / 2;
      a.x = mx; b.x = mx;
      break;
    }
    case "distance": {
      const a = P.get(c.a), b = P.get(c.b);
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-12) break; // degenerate: residual leg reports it, no direction to move along
      const shift = (c.value - d) / 2;
      const ux = dx / d, uy = dy / d;
      a.x -= ux * shift; a.y -= uy * shift;
      b.x += ux * shift; b.y += uy * shift;
      break;
    }
    default: break;
  }
}

const ENGINE_TIER = {
  requested: "L2",
  status: "NOT_COMPUTED",
  reason: "engine_unavailable:sxe-21",
  hint: "OCC parametric feature kernel (feature tree, configurations) is engine ticket SXE-21; the screening tier solves 2D sketch constraints only",
};

/** The pure solver function. Exported for direct testing. */
export function parametricFeatures(props = {}) {
  const points = props?.points;
  if (!Array.isArray(points) || points.length === 0) {
    return { notComputed: "missing_input:points", inputs: {} };
  }
  const ids = new Set();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p || typeof p.id !== "string" || !p.id) {
      return { notComputed: `INVALID_INPUT: points[${i}].id must be a non-empty string`, inputs: {} };
    }
    if (ids.has(p.id)) {
      return { notComputed: `INVALID_INPUT: points[${i}].id duplicates "${p.id}"`, inputs: {} };
    }
    ids.add(p.id);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) >= 1e300 || Math.abs(p.y) >= 1e300) {
      return { notComputed: `INVALID_INPUT: points[${i}] coordinates must be finite`, inputs: {} };
    }
  }
  const constraints = props?.constraints === undefined ? [] : props.constraints;
  if (!Array.isArray(constraints)) {
    return { notComputed: "INVALID_INPUT: constraints must be an array", inputs: {} };
  }
  for (let i = 0; i < constraints.length; i++) {
    const c = constraints[i];
    if (!c || !(c.type in WEIGHTS)) {
      return { notComputed: `INVALID_INPUT: constraints[${i}].type "${c?.type}" is not one of ${Object.keys(WEIGHTS).join("/")}`, inputs: {} };
    }
    const refs = c.type === "fixed" ? [c.point] : [c.a, c.b];
    for (const ref of refs) {
      if (!ids.has(ref)) {
        return { notComputed: `INVALID_INPUT: constraints[${i}] references unknown point "${ref}"`, inputs: {} };
      }
    }
    if (c.type === "fixed" && (!Number.isFinite(c.x) || !Number.isFinite(c.y))) {
      return { notComputed: `INVALID_INPUT: constraints[${i}] fixed target must be finite`, inputs: {} };
    }
    if (c.type === "distance" && (!Number.isFinite(c.value) || c.value <= 0 || c.value >= 1e300)) {
      return { notComputed: `INVALID_INPUT: constraints[${i}].value (distance) must be a positive finite number`, inputs: {} };
    }
  }

  const P = new Map(points.map((p) => [p.id, { x: p.x, y: p.y }]));
  let sweeps = 0;
  let maxResidual = constraints.length ? Infinity : 0;
  while (sweeps < MAX_SWEEPS && maxResidual > EPS) {
    for (const c of constraints) project(c, P);
    sweeps++;
    maxResidual = constraints.reduce((m, c) => Math.max(m, residualOf(c, P)), 0);
  }
  if (maxResidual > TOL) {
    return {
      notComputed: `solver_not_converged: sketch constraints did not settle within ${MAX_SWEEPS} sweeps (max residual ${maxResidual.toExponential(3)} > tolerance ${TOL}) — contradictory or degenerate constraints`,
      inputs: { points, constraints },
    };
  }
  const dofByCount = 2 * points.length - constraints.reduce((s, c) => s + WEIGHTS[c.type], 0);
  return {
    inputs: { points, constraints },
    outputs: {
      engineTier: ENGINE_TIER,
      screening: true,
      screeningTier: "sketch-constraints-relaxation",
      solvedPoints: points.map((p) => ({ id: p.id, x: P.get(p.id).x, y: P.get(p.id).y })),
      maxResidual,
      sweeps,
      dofByCount,
      dofNote: "by scalar-equation count, not rank — dependent constraints can make the true DOF higher",
      constraintCount: constraints.length,
    },
    assumptions: [],
    warnings: [`engine tier L2 NOT_COMPUTED: ${ENGINE_TIER.reason} (screening sketch solve reported beside it, labelled)`],
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function pfTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function pfRun(ctx, id) {
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
  return parametricFeatures(props);
}

registerSolver({
  id: "cad.parametric-features",
  version: "1.0.0",
  domain: "cad",
  domains: ["cad"],
  method: "parametric-features.sketch-solve",
  fidelity: 2,
  engineDependent: ["sxe-21"],
  regime: "2D sketches under fixed/coincident/horizontal/vertical/distance constraints; feature trees and configurations are the engine tier (SXE-21)",
  units: "sketch coordinates and distances in metres (SI), echoed as submitted",
  tolerance: "solve residual <= 1e-9 m after relaxation; DOF reported by scalar-equation count, not rank",
  screening: false,
  reference: "sketch constraint solving by successive projection (relaxation); reference case (constrained rectangle closes, DOF-by-count 0) in server/tests/conkay-cad-parametric-features.test.js",
  graphProp: NS,
  targets: pfTargets,
  run: pfRun,
});

export default { parametricFeatures };
