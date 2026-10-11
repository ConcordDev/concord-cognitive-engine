// server/lib/conkay/iterate/loop.js
//
// The iterate-to-physical loop (ConKay north star). Generic: it knows nothing
// about robots or cars. It takes a Design IR plus a list of BOUNDED design
// variables and:
//
//   1. compiles the IR to the design graph and runs every applicable solver
//      (the same registry, engine and receipts the car uses);
//   2. collects failed checks;
//   3. for each failure, finds the design variables the failing run actually
//      depends on (the engine records every value a solver reads, so the
//      link is computed, not declared) and tries their next options in
//      order, re-running only what each edit invalidates;
//   4. keeps a trial only if the failing check passes and nothing that
//      passed before now fails; otherwise reverts it and records why;
//   5. repeats until nothing fails, nothing applicable is left, or the
//      iteration limit is reached.
//
// It never edits a requirement: requirements and the IR's `locked` inputs
// are hashed before and after, and a design variable that touches either is
// refused up front. Requirement changes are only LISTED as options for the
// user. Domains are reported side by side; there is no combined score.

import { DesignGraph, nodeKey } from "../graph/design-graph.js";
import { DesignEngine } from "../graph/engine.js";
import { listSolvers } from "../physics/registry.js";
import { makeReceipt, sha256 } from "./receipt.js";

export const LOOP_VERSION = "1.0.0";

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Every key a run read, following result:… reads transitively. */
function dependencyClosure(engine, runId, seen = new Set()) {
  if (seen.has(runId)) return new Set();
  seen.add(runId);
  const out = new Set();
  for (const k of engine.dependencies(runId) || []) {
    out.add(k);
    if (k.startsWith("result:")) for (const d of dependencyClosure(engine, k.slice(7), seen)) out.add(d);
  }
  return out;
}

const touches = (a, b) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

function lockedSnapshot(graph, locked) {
  return {
    requirements: graph.requirements,
    locked: locked.map((l) => ({ ...l, value: getPath(graph.node(l.node) || {}, l.path) })),
  };
}

function validateVariables(graph, variables, locked) {
  const errors = [];
  const lockKeys = locked.map((l) => nodeKey(l.node, l.path));
  for (const v of variables) {
    if (!graph.node(v.node)) { errors.push(`variable ${v.id}: no node ${v.node}`); continue; }
    if (!Array.isArray(v.options) || v.options.length < 2) errors.push(`variable ${v.id}: needs an ordered list of ≥ 2 options (bounded)`);
    for (const o of v.options || []) {
      for (const path of Object.keys(o.set || {})) {
        if (lockKeys.some((k) => touches(k, nodeKey(v.node, path)))) errors.push(`variable ${v.id} would change locked input ${v.node}/${path} (a requirement): refused`);
      }
    }
  }
  return errors;
}

function currentOption(graph, v) {
  const n = graph.node(v.node);
  return v.options.findIndex((o) => Object.entries(o.set).every(([p, val]) => getPath(n, p) === val));
}

const worstUtil = (env) => Math.max(-Infinity, ...(env?.margins || []).map((m) => m.utilization));
const failing = (engine) => engine.results().filter((e) => e && (e.status === "FAIL"));

function summarizeEnvelope(e) {
  return {
    runId: e.runId, solver: e.solver?.id, version: e.solver?.version, domain: e.solver?.domain, status: e.status,
    screening: e.solver?.screening ?? null, regime: e.solver?.regime ?? null, tolerance: e.solver?.tolerance ?? null, units: e.solver?.units ?? null,
    target: e.target, reason: e.reason || e.error || null,
    margins: (e.margins || []).map((m) => ({ check: m.check, demand: m.demand, capacity: m.capacity, unit: m.unit, utilization: m.utilization })),
    failures: e.failures || [], warnings: e.warnings || [], assumptions: e.assumptions || [],
    outputs: e.outputs || {},
  };
}

/**
 * Run the loop. Returns { ok, report } or { ok:false, errors }.
 * options: { designVariables, excludeSolvers: [{ id, reason }], maxIterations, claims }
 */
export function iterateToPhysical(ir, { designVariables = [], excludeSolvers = [], maxIterations = 8, claims = [] } = {}) {
  const input = JSON.parse(JSON.stringify(ir));
  const built = DesignGraph.fromIR(JSON.parse(JSON.stringify(ir)));
  if (!built.ok) return { ok: false, errors: built.errors };
  const graph = built.graph;
  const locked = (ir.locked || []).map((l) => ({ node: l.node, path: l.path, reason: l.reason || "user requirement" }));
  const verrs = validateVariables(graph, designVariables, locked);
  if (verrs.length) return { ok: false, errors: verrs };
  const excluded = new Set(excludeSolvers.map((x) => x.id));
  const solverIds = listSolvers().map((s) => s.id).filter((id) => !excluded.has(id));
  const engine = new DesignEngine(graph, solverIds);
  engine.runAll();
  const lockHash0 = sha256(lockedSnapshot(graph, locked));
  const initial = engine.results().map(summarizeEnvelope);

  const log = [];
  let iteration = 0;
  let converged = failing(engine).length === 0;
  while (!converged && iteration < maxIterations) {
    iteration += 1;
    const fails = failing(engine).sort((a, b) => a.runId.localeCompare(b.runId));
    let accepted = null;
    for (const env of fails) {
      const deps = dependencyClosure(engine, env.runId);
      const vars = designVariables.filter((v) => Object.keys(v.options[0].set).some((p) => [...deps].some((d) => touches(d, nodeKey(v.node, p)))));
      for (const v of vars) {
        const cur = currentOption(graph, v);
        for (let k = cur + 1; k < v.options.length; k += 1) {
          const before = new Set(failing(engine).map((e) => e.runId));
          const utilBefore = worstUtil(engine.result(env.runId));
          const ops = Object.entries(v.options[k].set).map(([path, value]) => ({ node: v.node, path, value }));
          const r = engine.applyEdits(ops, { source: "repair", text: `${v.id} → ${v.options[k].label}` });
          if (!r.ok) { log.push({ iteration, failingRun: env.runId, variable: v.id, tried: v.options[k].label, result: "edit refused", reason: r.error }); continue; }
          const target = engine.result(env.runId);
          const newFails = failing(engine).map((e) => e.runId).filter((id) => !before.has(id));
          const entry = {
            iteration, failingRun: env.runId, variable: v.id, label: v.label,
            before: cur >= 0 ? v.options[cur].label : "(not an option)", after: v.options[k].label,
            targetStatus: target?.status, targetUtilizationBefore: utilBefore, targetUtilizationAfter: worstUtil(target),
            newFailures: newFails, rerun: r.rerun,
            statusChanges: r.changes.filter((c) => c.statusBefore !== c.statusAfter).map((c) => ({ runId: c.runId, from: c.statusBefore, to: c.statusAfter })),
          };
          if (target?.status !== "FAIL" && newFails.length === 0) {
            log.push({ ...entry, result: "accepted" });
            accepted = entry;
            break;
          }
          const undo = graph.history.at(-1).ops.map((o) => ({ node: o.node, path: o.path, value: o.before }));
          engine.applyEdits(undo, { source: "revert", text: `revert ${v.id}` });
          log.push({ ...entry, result: "reverted", reason: newFails.length ? `would newly fail ${newFails.join(", ")}` : `${env.runId} still fails` });
        }
        if (accepted) break;
      }
      if (accepted) break;
    }
    if (!accepted) break;
    converged = failing(engine).length === 0;
  }

  const lockHash1 = sha256(lockedSnapshot(graph, locked));
  if (lockHash0 !== lockHash1) throw new Error("iterate loop changed a requirement or locked input: refusing to report");

  const final = engine.results().map(summarizeEnvelope);
  const remaining = final.filter((c) => c.status === "FAIL");
  const requirementOptions = remaining.map((c) => {
    if (c.solver === "requirement.check") {
      const req = graph.requirements.find((q) => q.id === c.target);
      const v = c.outputs?.value;
      return { runId: c.runId, option: `relax "${req?.label}" to the achieved ${v ? `${+v.value.toPrecision(4)} ${v.unit}` : "value"}`, applied: false };
    }
    return { runId: c.runId, option: "no bounded design variable fixes this check; options: add a design variable, change the component, or change the requirement it serves", applied: false };
  });
  const byDomain = {};
  for (const c of final) {
    const d = (byDomain[c.domain || "requirement"] ||= { PASS: 0, WARN: 0, FAIL: 0, NOT_COMPUTED: 0, ERROR: 0, runs: [] });
    d[c.status] = (d[c.status] || 0) + 1;
    d.runs.push(c.runId);
  }
  const assumptions = [...new Set(final.flatMap((c) => c.assumptions.map((a) => `${a}`)))];
  const remainingClaims = claims.filter((c) => (c.status || []).some((s) => s === "hypothesis" || s === "contradicted")).map((c) => ({ id: c.id, status: c.status, bin: c.bin ?? null, statement: c.statement, notes: c.notes || [] }));
  const receipt = makeReceipt({ ir: input, solverIds, envelopes: engine.results(), finalDesign: graph.toJSON().nodes, loopVersion: LOOP_VERSION });
  return {
    ok: true,
    report: {
      loopVersion: LOOP_VERSION,
      design: graph.design,
      converged,
      iterations: iteration,
      maxIterations,
      excludedSolvers: excludeSolvers,
      initial,
      checks: final,
      byDomain,
      repairs: log,
      requirementsUnchanged: true,
      requirementsHash: lockHash1,
      requirementOptions,
      assumptions,
      remainingClaims,
      receipt,
      finalDesign: graph.toJSON(),
    },
  };
}
