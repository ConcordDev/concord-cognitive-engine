// server/lib/conkay/physics/registry.js
//
// The Solver Registry. Every solver is a discoverable, deterministic function
// with an id, version, physics domain and fidelity tier:
//
//   L0 symbolic · L1 analytical · L2 reduced numerical · L3 full numerical · L4 external/HPC
//
// A solver's run(ctx, target) returns its inputs, outputs and margins, or
// { notComputed: reason } when it cannot answer. The registry wraps that in
// the one envelope every result uses, which is the receipt:
//
//   { runId, status: PASS|FAIL|WARN|NOT_COMPUTED|ERROR, solver, target,
//     inputs, outputs, margins, failures, warnings, assumptions, covers, provenance, runtimeMs }
//
// A FAIL comes from a margin over 1, or from a named failure (a gate, such
// as an acceptance check, whose reasons are not a demand/capacity ratio).
//
// No solver estimates a value it was not given the inputs for.
//
// Optional declarations (north-star loop, spec section 8 rule 4): regime,
// units { inputs, outputs }, tolerance and screening (true = screening-level
// result, not a design check). They ride in every envelope's solver block.

import crypto from "node:crypto";

const SOLVERS = new Map();

export function registerSolver(s) {
  for (const k of ["id", "version", "domain", "method", "targets", "run"]) {
    if (s[k] == null) throw new Error(`solver ${s.id || "?"}: ${k} required`);
  }
  if (![0, 1, 2, 3, 4].includes(s.fidelity)) throw new Error(`solver ${s.id}: fidelity must be 0-4`);
  SOLVERS.set(s.id, Object.freeze({ ...s }));
  return s.id;
}

export function getSolver(id) {
  return SOLVERS.get(id) || null;
}

export function listSolvers() {
  return [...SOLVERS.values()].map(({ id, version, domain, domains, fidelity, method, reference, regime, units, tolerance, screening }) => ({
    id, version, domain, domains: domains || [domain], fidelity, method, reference: reference || null,
    ...declared({ regime, units, tolerance, screening }),
  }));
}

function declared({ regime, units, tolerance, screening }) {
  return {
    ...(regime != null ? { regime } : {}),
    ...(units != null ? { units } : {}),
    ...(tolerance != null ? { tolerance } : {}),
    ...(screening != null ? { screening: Boolean(screening) } : {}),
  };
}

export function runId(solverId, target) {
  return `${solverId}@${target}`;
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

const REL_TOL = 1e-9;
const numOf = (v) => (v && typeof v === "object" && "value" in v ? v.value : v);

/**
 * Generic no-substitution guard, applied to EVERY solver's raw answer. Returns a reason string or null.
 *   supplied: { name: number | {value} }  values the user explicitly gave (same key as the solver's echoed `inputs`)
 *   ignored:  string[]                     user inputs the engine cannot apply at all
 *   raw.substitutions: [{ name, supplied, used }]  a solver declaring that it used something other than what it was given
 * A solver echoing an input under a supplied name with a different value, or any ignored input, is never reported as computed.
 */
export function inputIntegrityViolation(raw, { supplied, ignored } = {}) {
  if (Array.isArray(ignored) && ignored.length) return `input_not_used:${ignored.join(", ")}`;
  for (const s of Array.isArray(raw?.substitutions) ? raw.substitutions : []) {
    if (s && s.name && !(Number.isFinite(s.supplied) && Number.isFinite(s.used) && Math.abs(s.supplied - s.used) <= REL_TOL * Math.max(1, Math.abs(s.supplied)))) {
      return `input_substituted:${s.name} (supplied ${s.supplied}, used ${s.used})`;
    }
  }
  for (const [name, v] of Object.entries(supplied || {})) {
    const want = Number(numOf(v));
    const echoed = raw?.inputs && Object.prototype.hasOwnProperty.call(raw.inputs, name) ? Number(numOf(raw.inputs[name])) : undefined;
    if (echoed === undefined || !Number.isFinite(want)) continue;
    if (!Number.isFinite(echoed) || Math.abs(echoed - want) > REL_TOL * Math.max(1, Math.abs(want))) return `input_substituted:${name} (supplied ${want}, used ${echoed})`;
  }
  return null;
}

/** Wrap a solver's raw answer in the common envelope. */
export function envelope(solver, target, raw, { runtimeMs, revision, supplied, ignored }) {
  const violation = raw && !raw.notComputed ? inputIntegrityViolation(raw, { supplied, ignored }) : null;
  if (violation) raw = { ...raw, notComputed: violation, outputs: {}, margins: [] };
  const base = {
    runId: runId(solver.id, target),
    solver: { id: solver.id, version: solver.version, domain: solver.domain, domains: solver.domains || [solver.domain], fidelity: `L${solver.fidelity}`, method: solver.method, reference: solver.reference || null, ...declared(solver) },
    target,
    runtimeMs,
  };
  if (raw?.notComputed) {
    // A solver may keep what it did compute beside the reason (e.g. a labelled screening estimate, or the receipt of
    // the run that could not finish); the status stays NOT_COMPUTED.
    return { ...base, status: "NOT_COMPUTED", reason: raw.notComputed, inputs: raw.inputs || {}, outputs: raw.outputs || {}, margins: [], warnings: raw.warnings || [], assumptions: raw.assumptions || [], covers: raw.covers || [target], ...(raw.receipt ? { engineReceipt: raw.receipt } : {}), provenance: { revision, computedAt: new Date().toISOString() } };
  }
  const inputs = raw.inputs || {};
  const margins = (raw.margins || []).map((m) => ({
    ...m,
    utilization: m.demand / m.capacity,
    marginPct: (m.capacity / m.demand - 1) * 100,
  }));
  const warnings = raw.warnings || [];
  // Pass/fail checks that are not a demand/capacity ratio (an interference,
  // a CG outside the support polygon) are reported as failures.
  const failures = raw.failures || [];
  let status = "PASS";
  if (failures.length || margins.some((m) => !(m.utilization <= 1))) status = "FAIL";
  else if (warnings.length) status = "WARN";
  return {
    ...base,
    status,
    inputs,
    outputs: raw.outputs || {},
    margins,
    ...(failures.length ? { failures } : {}),
    warnings,
    assumptions: raw.assumptions || [],
    covers: raw.covers || [target],
    // The wrapped engine's own receipt, when it produces one (e.g. the FEA analysisReceipt).
    ...(raw.receipt ? { engineReceipt: raw.receipt } : {}),
    provenance: {
      revision,
      computedAt: new Date().toISOString(),
      inputHash: crypto.createHash("sha256").update(canonical({ solver: solver.id, version: solver.version, target, inputs })).digest("hex"),
    },
  };
}
