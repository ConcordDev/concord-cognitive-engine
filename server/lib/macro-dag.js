// server/lib/macro-dag.js
//
// Phase 7 (idea #1) — Macro DAG composer.
//
// Wraps the existing `runMacro(domain, name, input, ctx)` registry with
// a declarative DAG composer. Users author a pipeline as
// `{ steps: [{id, macro, input, dependsOn?}] }` — the composer builds a
// dependency graph, executes in topological order, threads each step's
// output into successors that reference `${steps.<id>.<path>}`.
//
// Why: Concord has 686 macros. Most useful workflows are macro-A →
// transform → macro-B → fan-out. Today users write one-off code; this
// lets them save the pipeline as a custom lens / DTU and rerun with new
// inputs. "Zapier for cognition."
//
// The DAG is pure compute over the macro registry — no side effects of
// its own beyond what the underlying macros do.

const TEMPLATE_RE = /\$\{steps\.([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_.]+))?\}/g;

/**
 * Validate a DAG plan. Returns { ok, errors[] }.
 */
export function validateDag(plan) {
  const errors = [];
  if (!plan || !Array.isArray(plan.steps)) {
    errors.push("plan.steps must be an array");
    return { ok: false, errors };
  }
  const ids = new Set();
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    if (!s || typeof s !== "object") { errors.push(`step[${i}] must be an object`); continue; }
    if (!s.id) errors.push(`step[${i}] missing id`);
    else if (ids.has(s.id)) errors.push(`step[${i}] duplicate id '${s.id}'`);
    else ids.add(s.id);
    if (!s.macro || typeof s.macro !== "string" || !s.macro.includes(".")) {
      errors.push(`step[${i}] macro must be 'domain.name'`);
    }
    if (s.dependsOn && !Array.isArray(s.dependsOn)) {
      errors.push(`step[${i}] dependsOn must be an array of step ids`);
    }
  }
  // Cycle detection.
  const incoming = new Map();
  for (const s of plan.steps) incoming.set(s.id, new Set(s.dependsOn || []));
  // Validate every dependsOn refers to a known step.
  for (const [id, deps] of incoming) {
    for (const d of deps) {
      if (!ids.has(d)) errors.push(`step '${id}' depends on unknown step '${d}'`);
    }
  }
  // Toposort attempt — if it doesn't drain, there's a cycle.
  const order = [];
  const work = new Map(incoming);
  let progress = true;
  while (progress && order.length < ids.size) {
    progress = false;
    for (const [id, deps] of [...work]) {
      if (deps.size === 0) {
        order.push(id);
        work.delete(id);
        for (const [, others] of work) others.delete(id);
        progress = true;
      }
    }
  }
  if (order.length < ids.size) errors.push("plan contains a cycle");

  return { ok: errors.length === 0, errors, order };
}

/**
 * Resolve `${steps.<id>.<path>}` template references in an input
 * object using the running step results map.
 */
function resolveTemplate(value, results) {
  if (typeof value === "string") {
    return value.replace(TEMPLATE_RE, (_match, stepId, path) => {
      const result = results[stepId];
      if (result === undefined) return "";
      if (!path) return JSON.stringify(result);
      const parts = path.split(".");
      let cur = result;
      for (const p of parts) {
        if (cur && typeof cur === "object" && p in cur) cur = cur[p];
        else return "";
      }
      return typeof cur === "object" ? JSON.stringify(cur) : String(cur ?? "");
    });
  }
  if (Array.isArray(value)) return value.map(v => resolveTemplate(v, results));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = resolveTemplate(value[k], results);
    return out;
  }
  return value;
}

/**
 * Execute a validated DAG plan. `runMacro(domain, name, input, ctx)`
 * is the runtime injected by server.js — keeps this module pure.
 *
 * Returns { ok, results: { stepId: stepResult }, order, errors[]? }.
 */
export async function runDag(plan, ctx, runMacro) {
  const validation = validateDag(plan);
  if (!validation.ok) return { ok: false, errors: validation.errors, results: {} };
  if (typeof runMacro !== "function") return { ok: false, errors: ["runMacro injection required"], results: {} };

  const results = {};
  const errors = [];
  for (const stepId of validation.order) {
    const step = plan.steps.find(s => s.id === stepId);
    if (!step) continue;
    const [domain, name] = step.macro.split(".", 2);
    const resolvedInput = resolveTemplate(step.input || {}, results);
    try {
      const r = await runMacro(domain, name, resolvedInput, ctx);
      results[stepId] = r;
      if (step.failOnError !== false && r && r.ok === false) {
        errors.push(`step '${stepId}' returned ok:false (${r.error || r.reason || "unknown"})`);
        if (step.haltOnError !== false) break;
      }
    } catch (err) {
      errors.push(`step '${stepId}' threw: ${err?.message || err}`);
      results[stepId] = { ok: false, threw: String(err?.message || err) };
      if (step.haltOnError !== false) break;
    }
  }
  return {
    ok: errors.length === 0,
    results,
    order: validation.order,
    errors: errors.length ? errors : undefined,
  };
}

/**
 * Describe a plan: list step ids, dependency edges, and whether the plan
 * is currently runnable. Read-only for UI.
 */
export function describeDag(plan) {
  const v = validateDag(plan);
  if (!v.ok) return { ok: false, errors: v.errors };
  const edges = [];
  for (const s of plan.steps) {
    for (const d of (s.dependsOn || [])) edges.push({ from: d, to: s.id });
  }
  return {
    ok: true,
    stepCount: plan.steps.length,
    order: v.order,
    edges,
    macros: plan.steps.map(s => s.macro),
  };
}
