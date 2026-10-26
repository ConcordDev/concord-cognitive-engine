// server/lib/mcp-execution-bridge.js
//
// Concord MCP Execution Bridge — registry-backed tools that wrap the SAME
// paths humans use (chat-agent run_lens_action / ConKay solver registry),
// never a parallel implementation.
//
// Tools:
//   run_lens_action      — dual-registry lens/macro dispatch
//   list_lens_actions    — discovery (actions + input hints)
//   conkay_solver_list   — Solver Registry inventory
//   conkay_solve         — one solver id + design inputs → envelope + provenance
//   conkay_ir_schema     — worked Design IR example
//   conkay_compile_brief — short brief → Design IR (no invented sizes)

import { resolveDualRegistry } from "./dual-registry-resolve.js";
import { invokeLensHandler, lensActionSpec } from "./lens-action-dispatch.js";
import { MACRO_INPUT_HINTS } from "./macro-input-hints.js";
import { getCapabilityDescriptor } from "./runtime/capability-registry.js";
import {
  authorizeBridgeCall,
  bridgeActorCtx,
  classifyLensActionRisk,
  rejectImpersonation,
  BRIDGE_RISK,
} from "./mcp-hermes-identity.js";
import { formatIrErrors, CONKAY_IR_MINI_EXAMPLE, CONKAY_IR_HINTS } from "./conkay/compiler/soften-ir.js";
import { compileDesignBrief } from "./conkay/compiler/design-brief.js";

const PREFERRED_LENS_ACTIONS = [
  "task-add", "task-list", "search", "create", "save", "open", "from-brief",
  "edit", "get", "list", "export", "parse-brief", "feasibility", "solvers",
  "car-acceptance", "symbolicCompute", "power",
];
const PREFERRED_LENS_RANK = new Map(PREFERRED_LENS_ACTIONS.map((name, i) => [name, i]));

function rankLensActions(actions) {
  return actions.slice().sort((a, b) => {
    const an = a.action;
    const bn = b.action;
    const ap = PREFERRED_LENS_RANK.has(an) ? PREFERRED_LENS_RANK.get(an) : null;
    const bp = PREFERRED_LENS_RANK.has(bn) ? PREFERRED_LENS_RANK.get(bn) : null;
    if (ap != null || bp != null) {
      if (ap == null) return 1;
      if (bp == null) return -1;
      return ap - bp;
    }
    const aNest = an.includes(".") ? 1 : 0;
    const bNest = bn.includes(".") ? 1 : 0;
    if (aNest !== bNest) return aNest - bNest;
    return an.localeCompare(bn);
  });
}

function actorFromCallCtx(callCtx, args) {
  const base = callCtx?.actor || args?.__actor || null;
  if (!base) return null;
  // Credential boundary: when a csk_ API key is present, its scopes win over
  // the user-row scopes (hermes is seeded with ["*"] in the DB — the mint
  // script's least-privilege key scopes must still bind).
  const keyScopes = callCtx?.req?.apiKey?.scopes;
  if (Array.isArray(keyScopes) && keyScopes.length > 0) {
    return { ...base, scopes: keyScopes, authMethod: callCtx?.req?.authMethod || base.authMethod };
  }
  return base;
}

function stripInternalArgs(args = {}) {
  const out = { ...args };
  delete out.__actor;
  delete out.__trace_id;
  delete out.__call_ctx;
  return out;
}


function resolveLensRegistries(callCtx = null) {
  const lensActions =
    (callCtx?.lensActions instanceof Map ? callCtx.lensActions : null)
    || (globalThis.__concordLensActions instanceof Map ? globalThis.__concordLensActions : null);
  const runMacro =
    (typeof callCtx?.runMacro === "function" ? callCtx.runMacro : null)
    || (typeof globalThis.__concordRunMacro === "function" ? globalThis.__concordRunMacro : null);
  return { lensActions, runMacro };
}

function buildLensCtx(db, STATE, actor) {
  const stamped = bridgeActorCtx(actor);
  return {
    db: db || null,
    STATE: STATE || globalThis.STATE || null,
    actor: stamped,
    userId: stamped.userId,
    runMacro: typeof globalThis.__concordRunMacro === "function" ? globalThis.__concordRunMacro : null,
    lensActions: globalThis.__concordLensActions instanceof Map ? globalThis.__concordLensActions : null,
  };
}

/** Provenance tag for ConKay envelopes — sourced/computed/estimated/assumed/unknown. */
function provenanceFromEnvelope(env) {
  if (!env || typeof env !== "object") {
    return { kind: "unknown", note: "no envelope" };
  }
  if (env.status === "NOT_COMPUTED") {
    return {
      kind: "unknown",
      note: env.reason || "not_computed",
      validity: null,
      screening: env.solver?.screening ?? null,
      benchmark_refs: env.solver?.reference ? [env.solver.reference] : [],
    };
  }
  const assumptions = Array.isArray(env.assumptions) ? env.assumptions : [];
  const kind = assumptions.length
    ? "assumed"
    : (env.solver?.screening ? "estimated" : "computed");
  return {
    kind,
    computedAt: env.provenance?.computedAt || null,
    inputHash: env.provenance?.inputHash || null,
    revision: env.provenance?.revision ?? null,
    validity: env.solver?.tolerance || env.solver?.regime || null,
    screening: env.solver?.screening === true,
    benchmark_refs: [
      env.solver?.reference,
      ...(Array.isArray(env.covers) ? env.covers : []),
    ].filter(Boolean),
    assumptions,
  };
}

/**
 * list_lens_actions — discovery companion for run_lens_action.
 */
export async function listLensActionsMcp(db, args = {}, STATE = null, callCtx = null) {
  const clean = stripInternalArgs(args);
  const actor = actorFromCallCtx(callCtx, args);
  const imp = rejectImpersonation(actor, clean);
  if (!imp.ok) return { ok: false, ...imp };

  const auth = authorizeBridgeCall({
    actor,
    tool: "list_lens_actions",
    risk: BRIDGE_RISK.READ,
    domain: clean.domain || null,
  });
  if (!auth.ok) return { ok: false, ...auth };

  const domain = String(clean.domain || "").trim();
  if (!domain) return { ok: false, reason: "invalid_input", error: "domain required" };

  const { lensActions } = resolveLensRegistries(callCtx);
  if (!(lensActions instanceof Map)) {
    return { ok: false, reason: "lens_actions_unavailable", error: "LENS_ACTIONS not booted" };
  }

  const actions = new Map();
  const add = (action) => {
    const name = String(action ?? "").trim();
    if (!name || actions.has(name)) return;
    const fields = MACRO_INPUT_HINTS[`${domain}.${name}`];
    actions.set(name, fields ? { action: name, fields } : { action: name });
  };

  for (const key of lensActions.keys()) {
    const s = String(key);
    const dot = s.indexOf(".");
    if (dot < 0 || s.slice(0, dot) !== domain) continue;
    add(s.slice(dot + 1));
  }

  const ingestBucket = (registry) => {
    const bucket = registry?.get?.(domain);
    if (!bucket || typeof bucket.keys !== "function") return;
    for (const name of bucket.keys()) add(name);
  };
  try { ingestBucket(globalThis._concordMACROS); } catch { /* no live registry */ }
  try {
    const { MACRO_REGISTRY } = await import("./macro-reflection.js");
    ingestBucket(MACRO_REGISTRY);
  } catch { /* optional */ }

  const ranked = rankLensActions([...actions.values()]);
  return {
    ok: true,
    domain,
    total: ranked.length,
    actions: ranked,
    actor_id: imp.actorId,
    audited: true,
  };
}

/**
 * run_lens_action — wraps chat-agent's dual-registry dispatch.
 */
export async function runLensActionMcp(db, args = {}, STATE = null, callCtx = null) {
  const clean = stripInternalArgs(args);
  const actor = actorFromCallCtx(callCtx, args);
  const imp = rejectImpersonation(actor, clean);
  if (!imp.ok) return { ok: false, ...imp };

  const domain = String(clean.domain || "").trim();
  const action = String(clean.action || "").trim();
  if (!domain || !action) {
    return { ok: false, reason: "invalid_input", error: "domain and action are required" };
  }

  const cap = getCapabilityDescriptor(`${domain}.${action}`);
  const risk = classifyLensActionRisk(domain, action, cap?.risk || null);

  const auth = authorizeBridgeCall({
    actor,
    tool: "run_lens_action",
    risk,
    domain,
    approval: clean.approval === true,
    approvalToken: clean.approval_token || clean.approvalToken || null,
  });
  if (!auth.ok) return { ok: false, ...auth, domain, action, risk };

  const actionInput = (clean.params && typeof clean.params === "object") ? clean.params : {};
  const dryRun = clean.dry_run === true || clean.preview === true;

  const { lensActions, runMacro } = resolveLensRegistries(callCtx);

  const resolved = resolveDualRegistry(domain, action, { lensActions, runMacro });
  if (resolved.via === "none") {
    if (resolved.reason === "not_registered") {
      return {
        ok: false,
        reason: "not_registered",
        error: `no lens action "${domain}.${action}" — the name is wrong or it isn't registered`,
        retryHint: { tool: "list_lens_actions", args: { domain } },
      };
    }
    return { ok: false, reason: "lens_actions_unavailable", error: "lens_actions_unavailable" };
  }

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      preview: {
        key: resolved.key,
        via: resolved.via,
        domain,
        action,
        risk,
        input: actionInput,
        would_dispatch: true,
        note: "No side effects executed (dry_run/preview)",
      },
      actor_id: imp.actorId,
      idempotency_key: clean.idempotency_key || null,
      audited: true,
    };
  }

  const ctx = buildLensCtx(db, STATE, actor);
  try {
    const result = resolved.via === "lens_action"
      ? await invokeLensHandler(resolved.handler, ctx, null, actionInput, lensActionSpec(domain, action))
      : await runMacro(domain, action, actionInput, ctx);

    const failed = result && typeof result === "object" && result.ok === false;
    return {
      ok: !failed,
      key: resolved.key,
      domain,
      action,
      risk,
      via: resolved.via,
      input: actionInput,
      result,
      actor_id: imp.actorId,
      idempotency_key: clean.idempotency_key || null,
      audited: true,
      ...(failed ? { reason: result.reason || result.error || "handler_reported_failure" } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      reason: "handler_threw",
      error: `lens action error: ${err?.message || String(err)}`,
      domain,
      action,
      risk,
      actor_id: imp.actorId,
      audited: true,
    };
  }
}

/**
 * conkay_solver_list — Solver Registry inventory (no hard-coded tool-per-solver).
 */
export async function conkaySolverListMcp(db, args = {}, STATE = null, callCtx = null) {
  const clean = stripInternalArgs(args);
  const actor = actorFromCallCtx(callCtx, args);
  const imp = rejectImpersonation(actor, clean);
  if (!imp.ok) return { ok: false, ...imp };

  const auth = authorizeBridgeCall({
    actor,
    tool: "conkay_solver_list",
    risk: BRIDGE_RISK.READ,
  });
  if (!auth.ok) return { ok: false, ...auth };

  // Side-effect import registers every solver on the registry
  const { listSolvers } = await import("./conkay/index.js");
  let solvers = listSolvers();
  if (clean.domain) {
    const d = String(clean.domain);
    solvers = solvers.filter((s) => s.domain === d || (s.domains || []).includes(d));
  }
  if (clean.fidelity != null) {
    const f = Number(clean.fidelity);
    solvers = solvers.filter((s) => s.fidelity === f);
  }

  return {
    ok: true,
    total: solvers.length,
    solvers,
    actor_id: imp.actorId,
    audited: true,
    note: "screening=true means screening-level, not a design check; unknown stays unknown",
  };
}

/**
 * conkay_solve — run one registry solver against a design IR (or designId).
 */
export async function conkaySolveMcp(db, args = {}, STATE = null, callCtx = null) {
  const clean = stripInternalArgs(args);
  const actor = actorFromCallCtx(callCtx, args);
  const imp = rejectImpersonation(actor, clean);
  if (!imp.ok) return { ok: false, ...imp };

  const auth = authorizeBridgeCall({
    actor,
    tool: "conkay_solve",
    risk: BRIDGE_RISK.COMPUTE,
  });
  if (!auth.ok) return { ok: false, ...auth };

  const solverId = String(clean.solver_id || clean.solverId || "").trim();
  if (!solverId) {
    return { ok: false, reason: "invalid_input", error: "solver_id required (use conkay_solver_list)" };
  }

  const { openDesign, listSolvers } = await import("./conkay/index.js");
  const { getSolver } = await import("./conkay/physics/registry.js");
  const { DesignGraph } = await import("./conkay/graph/design-graph.js");

  const solver = getSolver(solverId);
  if (!solver) {
    const known = listSolvers().map((s) => s.id).slice(0, 20);
    return {
      ok: false,
      reason: "unknown_solver",
      error: `solver "${solverId}" is not in the registry`,
      hint: { tool: "conkay_solver_list", sample_ids: known },
    };
  }

  let ir = clean.ir || clean.design?.ir || null;
  if (!ir && clean.designId) {
    if (!db) return { ok: false, reason: "no_database", error: "designId requires db" };
    const row = db.prepare("SELECT * FROM conkay_designs WHERE id = ?").get(String(clean.designId));
    if (!row) return { ok: false, reason: "not_found", error: "design not found" };
    // Tenant isolation: only the owner (or hermes reading hermes-owned) may load
    if (row.owner_id !== imp.actorId) {
      return { ok: false, reason: "tenant_isolation", error: "design belongs to another account" };
    }
    try { ir = JSON.parse(row.ir_json); } catch {
      return { ok: false, reason: "invalid_stored_ir", error: "stored design IR is not valid JSON" };
    }
  }
  if (!ir || typeof ir !== "object") {
    return { ok: false, reason: "invalid_input", error: "provide ir (Design IR) or designId" };
  }

  if (clean.dry_run === true || clean.preview === true) {
    const built = DesignGraph.fromIR(ir);
    if (!built.ok) {
      return { ok: false, reason: "ir_invalid", error: "design did not compile", ...formatIrErrors(built.errors, built.warnings) };
    }
    const targets = typeof solver.targets === "function" ? solver.targets(built.graph) : [];
    return {
      ok: true,
      dry_run: true,
      preview: {
        solver_id: solverId,
        version: solver.version,
        domain: solver.domain,
        fidelity: solver.fidelity,
        screening: solver.screening ?? null,
        targets,
        would_run: targets.length,
      },
      actor_id: imp.actorId,
      audited: true,
    };
  }

  // Prefer a focused engine (only this solver + whatever it depends on via
  // ctx.result). openDesign runs ALL solvers — too heavy for MCP single-solve.
  const built = DesignGraph.fromIR(ir);
  if (!built.ok) {
    return { ok: false, reason: "ir_invalid", error: "design did not compile", ...formatIrErrors(built.errors, built.warnings) };
  }

  // Include dependency solvers that this solver may pull via ctx.result —
  // running the full registry for the design is the honest path when the
  // single solver has unknown deps. Cap: use openDesign for correctness.
  const opened = openDesign(ir);
  if (!opened.ok) {
    return { ok: false, reason: "ir_invalid", error: "design did not compile", ...formatIrErrors(opened.errors, opened.warnings) };
  }

  const targetFilter = clean.target != null ? String(clean.target) : null;
  const envelopes = opened.session.results().filter((e) => {
    if (!e || e.solver?.id !== solverId) return false;
    if (targetFilter && String(e.target) !== targetFilter) return false;
    return true;
  });

  if (!envelopes.length) {
    // Solver registered but no targets in this design — honest empty
    return {
      ok: true,
      solver_id: solverId,
      status: "NOT_COMPUTED",
      reason: targetFilter
        ? `no run for solver ${solverId} @ target ${targetFilter}`
        : `solver ${solverId} has no applicable targets in this design`,
      results: [],
      provenance: { kind: "unknown", note: "no_applicable_targets" },
      actor_id: imp.actorId,
      audited: true,
    };
  }

  const results = envelopes.map((env) => ({
    runId: env.runId,
    status: env.status,
    target: env.target,
    inputs: env.inputs,
    outputs: env.outputs,
    margins: env.margins,
    failures: env.failures || [],
    warnings: env.warnings || [],
    assumptions: env.assumptions || [],
    solver: env.solver,
    provenance: provenanceFromEnvelope(env),
    runtimeMs: env.runtimeMs,
  }));

  const worst = results.some((r) => r.status === "FAIL" || r.status === "ERROR")
    ? "FAIL"
    : results.some((r) => r.status === "WARN")
      ? "WARN"
      : results.every((r) => r.status === "NOT_COMPUTED")
        ? "NOT_COMPUTED"
        : "PASS";

  return {
    ok: true,
    solver_id: solverId,
    status: worst,
    results,
    provenance: results.length === 1
      ? results[0].provenance
      : { kind: "computed", note: `${results.length} runs`, runs: results.map((r) => r.provenance) },
    summary: opened.session.summary(),
    actor_id: imp.actorId,
    idempotency_key: clean.idempotency_key || null,
    audited: true,
    note: "screening ≠ validation; unknown stays unknown",
  };
}


/**
 * conkay_ir_schema — worked Design IR example + hints (read-only).
 * Agents call this before conkay_solve when unsure of the contract.
 */
export async function conkayIrSchemaMcp(db, args = {}, STATE = null, callCtx = null) {
  const clean = stripInternalArgs(args);
  const actor = actorFromCallCtx(callCtx, args);
  const imp = rejectImpersonation(actor, clean);
  if (!imp.ok) return { ok: false, ...imp };
  const auth = authorizeBridgeCall({
    actor,
    tool: "conkay_ir_schema",
    risk: BRIDGE_RISK.READ,
  });
  if (!auth.ok) return { ok: false, ...auth };
  return {
    ok: true,
    hints: [...CONKAY_IR_HINTS],
    example: CONKAY_IR_MINI_EXAMPLE,
    notes: [
      "Pass example as `ir` to conkay_solve with a solver_id from conkay_solver_list.",
      "Bare SI numbers are accepted for typed quantities; unit strings are preferred.",
      "Missing massSource is auto-filled as a caller assumption (see warnings).",
    ],
    actor_id: imp.actorId,
    audited: true,
  };
}

/**
 * conkay_compile_brief — a short design sentence → Design IR.
 * Robot briefs become Joint / Actuator / Limb nodes. Missing sizes stay
 * missing. Cars and L-brackets delegate to compileBrief.
 */
export async function conkayCompileBriefMcp(db, args = {}, STATE = null, callCtx = null) {
  const clean = stripInternalArgs(args);
  const actor = actorFromCallCtx(callCtx, args);
  const imp = rejectImpersonation(actor, clean);
  if (!imp.ok) return { ok: false, ...imp };
  const auth = authorizeBridgeCall({
    actor,
    tool: "conkay_compile_brief",
    risk: BRIDGE_RISK.READ,
  });
  if (!auth.ok) return { ok: false, ...auth };
  const brief = clean.brief ?? clean.text ?? "";
  const compiled = compileDesignBrief(typeof brief === "string" ? brief : "");
  if (!compiled.ok) {
    return {
      ok: false,
      reason: "brief_incomplete",
      error: compiled.error,
      ...(compiled.missing ? { missing: compiled.missing } : {}),
      hints: compiled.hints || [...CONKAY_IR_HINTS],
      actor_id: imp.actorId,
      audited: true,
    };
  }
  return {
    ok: true,
    architecture: compiled.architecture,
    ir: compiled.ir,
    warnings: compiled.warnings || [],
    assumptions: compiled.assumptions || [],
    ...(compiled.spec ? { spec: compiled.spec } : {}),
    ...(compiled.unmapped ? { unmapped: compiled.unmapped } : {}),
    actor_id: imp.actorId,
    audited: true,
    note: "Compiled from the brief with registry material ids. Screening IR. Quantities that were not in the brief are not invented.",
  };
}
