// server/lib/conkay/solve-direct.js
//
// SC-00: the solve.direct entry — run one registered solver against
// caller-supplied typed inputs, without a Design IR.
//
// The entry is deliberately thin: it validates the typed inputs at its own
// boundary (SC-04), builds the minimal in-memory Design IR for one node,
// and runs the production machinery entire — openDesign → DesignEngine →
// envelope — so the direct path inherits the IR path's behaviour, including
// the SC-05 input-integrity arming (a solver echoing a value different from
// what the caller declared is refused input_substituted on this path too).
//
// SC-04: the refusal seam lives HERE, at the solver-input boundary, and
// nowhere else. A dimensional field supplied as a bare number, a unit-less
// string, or a unit-less { value } object is REFUSED (INVALID_INPUT naming
// the field) — the catalogue's adversarial case, riding every solver row.
// parseQuantity itself is untouched: the design-IR/chat authoring path
// keeps its deliberate bare-SI coercion (agents write position {x:0,y:0,z:0}
// or mass: 1.5; that coercion is tested and stays). The direct entry's
// caller is stating solver inputs, not authoring a design, so on this path
// a bare number on a dimensional field is an incomplete input, not a
// convention.
//
// Inputs shape (one node; multi-node structure is out of scope — see the
// doc entry docs/conkay/sc-00-solve-direct.md):
//   {
//     node: { id?, kind, material?, name?, geometry?, props?, position? },
//     loadCases?: [{ id, loads: [{ target?, <load field>: <quantity>, ... }] }]
//   }
// Geometry values, position axes, and TYPED_PROPS props are dimensional;
// load fields are dimensional by contract (every numeric load field is a
// physical quantity); all other props pass through as the solver's own
// domain (strings, booleans, dimensionless numbers).
//
// Every quantity may arrive as a number, a string ("4 m"), or an object
// { value, unit } — parseQuantity's three forms. Only the bare forms are
// refused; a declared unit converts exactly through the compiler.

import { openDesign } from "./index.js";
import { getSolver } from "./physics/registry.js";
import { parseQuantity } from "./compiler/units.js";
import { paramDim, TYPED_PROPS } from "./compiler/design-ir.js";

export const DIRECT_NODE_ID = "N1";

function isBare(v) {
  if (typeof v === "number") return true;
  if (typeof v === "string") return /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(v.trim());
  if (v && typeof v === "object") return v.unit == null || v.unit === "" || v.unit === "1";
  return false;
}

/**
 * Refusal for one dimensional field, or null when the value is fine.
 * `dim` is the field's declared dimension when known (geometry/position/
 * typed props); for load fields it is null and the refusal names the field
 * plus the remedy without a dimension.
 */
function dimensionalRefusal(field, value, dim) {
  if (!isBare(value)) return null;
  if (dim) {
    const example = dim === "mass" ? `"${value} kg"` : dim === "length" ? `"${value} m"` : `"${value} ${dim}"`;
    return {
      field,
      error: `bare number on a dimensional input: ${field} is a ${dim} and arrived without a unit. Declare the unit, e.g. ${example}`,
    };
  }
  return {
    field,
    error: `bare number on a dimensional input: ${field} is a physical quantity and arrived without a unit. Declare the unit, e.g. ${field}: "60 kN"`,
  };
}

/**
 * Validate the typed inputs at the direct boundary. Returns { ok: true }
 * or { ok: false, field, error }. A value that fails parseQuantity at all
 * (unknown unit, wrong dimension) is also refused here with the compiler's
 * own wording, so the caller hears it as an input error, not a compile one.
 */
export function validateDirectInputs(spec) {
  if (!spec || typeof spec !== "object" || !spec.node || typeof spec.node !== "object") {
    return { ok: false, field: "node", error: "solve.direct inputs require a node { kind, ... } — a bare solver call with no node cannot run" };
  }
  const node = spec.node;
  if (node.geometry && typeof node.geometry === "object") {
    for (const [key, value] of Object.entries(node.geometry)) {
      if (key === "shape") continue;
      const dim = paramDim(key);
      const q = parseQuantity(value, dim);
      if (!q.ok) return { ok: false, field: `node.geometry.${key}`, error: `node.geometry.${key}: ${q.error}` };
      if (q.coercedBare) return { ok: false, ...dimensionalRefusal(`node.geometry.${key}`, value, dim) };
    }
  }
  if (node.position && typeof node.position === "object") {
    for (const axis of ["x", "y", "z"]) {
      if (node.position[axis] == null) continue;
      const q = parseQuantity(node.position[axis], "length");
      if (!q.ok) return { ok: false, field: `node.position.${axis}`, error: `node.position.${axis}: ${q.error}` };
      if (q.coercedBare) return { ok: false, ...dimensionalRefusal(`node.position.${axis}`, node.position[axis], "length") };
    }
  }
  if (node.props && typeof node.props === "object") {
    for (const [key, dim] of Object.entries(TYPED_PROPS)) {
      if (node.props[key] == null) continue;
      const q = parseQuantity(node.props[key], dim);
      if (!q.ok) return { ok: false, field: `node.props.${key}`, error: `node.props.${key}: ${q.error}` };
      if (q.coercedBare) return { ok: false, ...dimensionalRefusal(`node.props.${key}`, node.props[key], dim) };
    }
  }
  for (const lc of spec.loadCases || []) {
    for (const load of lc.loads || []) {
      for (const [key, value] of Object.entries(load)) {
        if (key === "target") continue;
        if (typeof value === "string" || typeof value === "number" || (value && typeof value === "object")) {
          const r = dimensionalRefusal(`loadCases.${lc.id || "?"}.loads.${key}`, value, null);
          if (r) return { ok: false, ...r };
        }
      }
    }
  }
  return { ok: true };
}

/** Build the minimal one-node Design IR the direct spec describes. Assumes validated input. */
export function buildDirectIR(spec) {
  const nodeId = spec.node.id || DIRECT_NODE_ID;
  const node = {
    id: nodeId,
    kind: spec.node.kind,
    ...(spec.node.name != null ? { name: spec.node.name } : {}),
    ...(spec.node.material != null ? { material: spec.node.material } : {}),
    ...(spec.node.props != null ? { props: spec.node.props } : {}),
    ...(spec.node.geometry != null ? { geometry: spec.node.geometry } : {}),
    ...(spec.node.position != null ? { position: spec.node.position } : {}),
  };
  const loadCases = (spec.loadCases || []).map((lc) => ({
    id: lc.id || "LC1",
    loads: (lc.loads || []).map((l) => ({ target: l.target || nodeId, ...Object.fromEntries(Object.entries(l).filter(([k]) => k !== "target")) })),
  }));
  return { design: { id: "direct" }, nodes: [node], loadCases };
}

/**
 * Run one registered solver against typed inputs. Returns the envelope
 * (the same shape the IR path returns for one run), or a refusal object:
 *   { ok: true, solver_id, status, results: [envelope, ...] }
 *   { ok: false, reason: "unknown_solver" | "invalid_input" | "ir_invalid", error, ... }
 * Multi-node solvers (children/aggregators) honestly return NOT_COMPUTED
 * through their own run — the direct entry serves the single-node solver
 * population, which is the catalogue's typed-input shape.
 */
export async function solveDirect(solverId, spec, opts = {}) {
  const solver = getSolver(solverId);
  if (!solver) {
    return { ok: false, reason: "unknown_solver", error: `solver "${solverId}" is not in the registry` };
  }
  const v = validateDirectInputs(spec);
  if (!v.ok) {
    return { ok: false, reason: "invalid_input", field: v.field, error: v.error };
  }
  const ir = buildDirectIR(spec);
  const opened = openDesign(ir);
  if (!opened.ok) {
    return { ok: false, reason: "ir_invalid", error: "typed inputs did not compile", errors: opened.errors, ...(opened.warnings ? { warnings: opened.warnings } : {}) };
  }
  await opened.session.settle();
  const targetFilter = opts.target != null ? String(opts.target) : null;
  const results = opened.session.results().filter((e) => {
    if (!e || e.solver?.id !== solverId) return false;
    if (targetFilter && String(e.target) !== targetFilter) return false;
    return true;
  });
  if (!results.length) {
    return {
      ok: true,
      solver_id: solverId,
      status: "NOT_COMPUTED",
      reason: targetFilter
        ? `no run for solver ${solverId} @ target ${targetFilter}`
        : `solver ${solverId} has no applicable targets for these inputs`,
      results: [],
    };
  }
  return { ok: true, solver_id: solverId, status: results[0].status, results };
}
