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
  return [...SOLVERS.values()].map(({ id, version, domain, domains, fidelity, method, reference }) => ({ id, version, domain, domains: domains || [domain], fidelity, method, reference: reference || null }));
}

export function runId(solverId, target) {
  return `${solverId}@${target}`;
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** Wrap a solver's raw answer in the common envelope. */
export function envelope(solver, target, raw, { runtimeMs, revision }) {
  const base = {
    runId: runId(solver.id, target),
    solver: { id: solver.id, version: solver.version, domain: solver.domain, domains: solver.domains || [solver.domain], fidelity: `L${solver.fidelity}`, method: solver.method, reference: solver.reference || null },
    target,
    runtimeMs,
  };
  if (raw?.notComputed) {
    return { ...base, status: "NOT_COMPUTED", reason: raw.notComputed, inputs: raw.inputs || {}, outputs: {}, margins: [], warnings: [], assumptions: [], covers: raw.covers || [target], provenance: { revision, computedAt: new Date().toISOString() } };
  }
  const inputs = raw.inputs || {};
  const margins = (raw.margins || []).map((m) => ({
    ...m,
    utilization: m.demand / m.capacity,
    marginPct: (m.capacity / m.demand - 1) * 100,
  }));
  const warnings = raw.warnings || [];
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
