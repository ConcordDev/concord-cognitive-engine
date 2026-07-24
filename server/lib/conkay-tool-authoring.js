// server/lib/conkay-tool-authoring.js
//
// First-buildable slice of docs/CONKAY_TOOL_AUTHORING_SPEC.md §7 point 2 —
// the propose -> approve|reject -> revoke state machine for a ConKay
// authored tool, DB-backed (migration 385), following the same four-state
// discipline as server/lib/repair-remediation.js but persisted (an
// authored tool is not re-derivable from anything the way remediation
// candidates re-derive from a live detector sweep).
//
// ── Design call: DSL vs. plugin static validation (spec §2b, §7 point 2) ──
//
// The spec asks for "the SAME 4-gate static validator" (server/plugins/
// validator.js: shape / namespace / patterns / dependencies) to run and
// pass BEFORE a human ever sees a proposal — but flags that the validator's
// shape/namespace gates assume a `{id, name, version, init, macros, ...}`
// plugin-module object, which a raw DSL program (server/lib/dsl.js's small
// let/if/macro-call language) simply does not have. This module adapts as
// follows, and the choice is deliberate, not a shortcut:
//
//   kind: 'dsl' — the shape/namespace gates do not apply (there is no
//     module to reflect). Instead:
//       (a) `parse()` from dsl.js must succeed — a syntactically invalid
//           program is rejected at propose() time, not discovered at first
//           invocation.
//       (b) the declared `manifest` (capability grants) is checked against
//           AGENT_FORBIDDEN_DOMAINS (server/lib/agent-guardrails.js) and a
//           local mirror of confined-ctx.js's NEVER_ALLOW set (that set is
//           module-private there, not exported — this is a static
//           PRE-check; the real, load-bearing enforcement still happens
//           again at invocation time inside makeConfinedCtx itself,
//           belt-and-suspenders, never the only gate).
//     validator.js's JS-source `patterns` gate is NOT run against DSL text
//     — it hunts for `eval(`, `process.exit`, `require('fs')`, etc., which
//     are JS constructs a DSL program's grammar cannot even express (dsl.js
//     has no notion of a raw function call other than `domain.macro(...)`),
//     so running it would just be decorative, not a real gate.
//
//   kind: 'sandboxed_code' — this source IS plugin-shaped ESM text, so the
//     REAL validator.js pipeline is run the same two-layer way
//     server/plugins/loader.js#loadPluginFromSource already does:
//       Layer 1 — the fast pattern probe against the raw source text (no
//         worker spun up yet) — unchanged validator.js, exact same probe
//         shape loader.js uses.
//       Layer 2 — only if layer 1 passes: spin up the SAME
//         `PluginSandbox` worker+vm isolation a real plugin loads through,
//         purely to reflect the module's real shape (id/name/version/
//         macros/hooks) — bridge is a no-op stub (propose() never
//         activates or registers anything), and the sandbox is torn down
//         immediately after reflection. The full 4-gate validator then
//         runs against that REAL reflected shape, exactly as loader.js's
//         own "layer 2" does. There is no window where the validated shape
//         could differ from the code that later executes.
//     The manifest domain-grant check (b above) also applies to this kind.
//
// Neither kind's static gate is a replacement for confined-ctx.js's runtime
// enforcement (AGENT_FORBIDDEN_DOMAINS / NEVER_ALLOW / capability manifest)
// — it is an honest, EARLY rejection so a forbidden-domain tool never even
// reaches a human reviewer, per spec §2b Tier 1.

import crypto from "node:crypto";
import { parse as parseDsl, DslError } from "./dsl.js";
import { AGENT_FORBIDDEN_DOMAINS } from "./agent-guardrails.js";
import { validatePlugin as runPluginValidation } from "../plugins/validator.js";
import { PluginSandbox } from "./plugin-sandbox.js";

// Mirrors server/lib/confined-ctx.js's NEVER_ALLOW set. Not imported —
// that constant is module-private there (not exported). Duplicated here
// ONLY as an early static pre-check; the real, load-bearing enforcement is
// makeConfinedCtx's own NEVER_ALLOW check at invocation time, every call,
// regardless of what this propose-time gate found.
const NEVER_ALLOW_MIRROR = new Set([
  "economy.mint", "economy.withdraw", "economy.transfer",
  "admin.*", "config.*",
]);

function nowId() {
  return `ctool_${crypto.randomUUID().slice(0, 16)}`;
}

function extractGrants(manifest) {
  if (Array.isArray(manifest)) return manifest;
  if (Array.isArray(manifest?.macros)) return manifest.macros;
  if (Array.isArray(manifest?.grants)) return manifest.grants;
  return [];
}

/** Static gate shared by both kinds: manifest domain grants vs. the two hard backstops. */
function checkManifestGrants(grants) {
  const errors = [];
  for (const g of Array.isArray(grants) ? grants : []) {
    const s = String(g || "").trim().toLowerCase();
    if (!s) continue;
    const domain = s.endsWith(".*") ? s.slice(0, -2) : s.split(".")[0];
    if (AGENT_FORBIDDEN_DOMAINS.includes(domain)) {
      errors.push(`forbidden_domain_grant: '${g}' targets domain '${domain}', which is in AGENT_FORBIDDEN_DOMAINS and can never be reached from a confined context`);
    }
    if (NEVER_ALLOW_MIRROR.has(s) || NEVER_ALLOW_MIRROR.has(`${domain}.*`)) {
      errors.push(`never_allow_grant: '${g}' is hard-denied regardless of manifest (mirrors confined-ctx.js's NEVER_ALLOW)`);
    }
  }
  return { passed: errors.length === 0, errors };
}

/** Build a stub "reflection" module object from a sandbox-reported shape so
 * the unmodified validator.js gates (which expect real typeof-function
 * exports) can run — mirrors server/plugins/loader.js's private
 * `reflectionModuleFromShape` (not exported there, so reimplemented here;
 * only shape/typeof matters to the validator, stub bodies are never
 * invoked). */
function reflectionModuleFromShape(shape) {
  const stub = () => ({ ok: true });
  const macros = {};
  for (const name of shape?.macroNames || []) macros[name] = stub;
  const hooks = {};
  for (const name of shape?.hookNames || []) hooks[name] = stub;
  return {
    id: shape?.id, name: shape?.name, version: shape?.version,
    description: shape?.description, author: shape?.author, license: shape?.license,
    intent: shape?.intent || null,
    init: shape?.hasInit ? stub : undefined,
    destroy: shape?.hasDestroy ? stub : undefined,
    macros, hooks,
    tick: shape?.hasTick ? stub : undefined,
  };
}

async function staticValidateDsl(source, grants) {
  const gates = [];
  const parseErrors = [];
  try { parseDsl(source); } catch (e) {
    parseErrors.push(e instanceof DslError ? e.message : String(e?.message || e));
  }
  gates.push({ name: "dsl_syntax", passed: parseErrors.length === 0, errors: parseErrors });
  gates.push({ name: "manifest_domain_grants", ...checkManifestGrants(grants) });
  return gates;
}

async function staticValidateSandboxedCode(source, grants) {
  const gates = [];

  // Layer 1 — fast pattern probe on raw source, no worker spun up yet.
  // Exact same probe shape loader.js#loadPluginFromSource uses.
  const patternProbe = runPluginValidation(
    { id: "probe.pending", name: "pending", version: "0.0.0", init() {}, destroy() {} },
    { sourceCode: source, isEmergentGen: false },
  );
  const patternsGate = patternProbe.gates.find((g) => g.name === "patterns") || { name: "patterns", passed: true, errors: [] };
  gates.push(patternsGate);

  if (patternsGate.passed) {
    // Layer 2 — spin up the real PluginSandbox worker+vm isolation purely
    // to reflect the module's real shape. bridge:{} → every host-call the
    // module might make during load/eval is a `bridge_not_wired` refusal;
    // nothing is activated or registered. Torn down immediately after.
    let shape = null;
    let sandbox = null;
    try {
      sandbox = new PluginSandbox({ pluginId: `pending.${Date.now().toString(36)}`, sourceCode: source, bridge: {} });
      shape = await sandbox.load();
    } catch (err) {
      gates.push({ name: "shape", passed: false, errors: [`sandbox_load_failed: ${err?.message || err}`] });
    } finally {
      if (sandbox) { try { await sandbox.destroy(); } catch { /* best effort */ } }
    }
    if (shape) {
      const reflection = reflectionModuleFromShape(shape);
      const full = runPluginValidation(reflection, { isEmergentGen: false, sourceCode: source });
      for (const g of full.gates) {
        if (g.name === "patterns") continue; // already ran above against the real source
        gates.push(g);
      }
    }
  }

  gates.push({ name: "manifest_domain_grants", ...checkManifestGrants(grants) });
  return gates;
}

/**
 * Propose a new authored tool. Runs the static validation gate appropriate
 * to `kind` (see the design-call note above) BEFORE any human review, per
 * spec §2b Tier 1 — a proposal that fails static validation is stamped
 * `status:'rejected'` immediately (an honest audit row, but it never enters
 * the pending-review queue a human would see via `listPending`).
 */
export async function propose(db, ownerId, opts = {}) {
  if (!db || !ownerId) return { ok: false, reason: "missing_inputs" };
  const {
    name, description = "", kind, source,
    manifest = [], inputSchema = null,
    ownerType = "user", ownerOrgId = null,
  } = opts || {};

  if (!name || typeof name !== "string") return { ok: false, reason: "missing_name" };
  if (kind !== "dsl" && kind !== "sandboxed_code") return { ok: false, reason: "invalid_kind" };
  if (typeof source !== "string" || !source.trim()) return { ok: false, reason: "missing_source" };
  if (ownerType !== "user" && ownerType !== "org") return { ok: false, reason: "invalid_owner_type" };
  if (ownerType === "org" && !ownerOrgId) return { ok: false, reason: "missing_owner_org_id" };

  const grants = extractGrants(manifest);
  const gates = kind === "dsl"
    ? await staticValidateDsl(source, grants)
    : await staticValidateSandboxedCode(source, grants);

  const passed = gates.every((g) => g.passed);
  const staticValidation = {
    valid: passed,
    kind,
    gates,
    errors: gates.flatMap((g) => (g.errors || []).map((e) => `[${g.name}] ${e}`)),
    checkedAt: new Date().toISOString(),
  };

  const id = nowId();
  const status = passed ? "proposed" : "rejected";

  db.prepare(`
    INSERT INTO conkay_authored_tools
      (id, owner_user_id, owner_type, owner_org_id, name, description, kind, source,
       manifest_json, input_schema_json, status, static_validation_json,
       rejected_at, rejected_by, reject_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, ownerId, ownerType, ownerOrgId || null, String(name).slice(0, 200), String(description).slice(0, 2000),
    kind, source, JSON.stringify(grants), inputSchema ? JSON.stringify(inputSchema) : null,
    status, JSON.stringify(staticValidation),
    passed ? null : Math.floor(Date.now() / 1000),
    passed ? null : "system:static_validation_gate",
    passed ? null : "rejected at propose() time: static validation gate failed",
  );

  return { ok: passed, id, status, staticValidation };
}

/** Read-only queue snapshot: proposals awaiting human review. */
export function listPending(db, opts = {}) {
  if (!db) return [];
  const { ownerId = null, ownerOrgId = null } = opts || {};
  let sql = `SELECT * FROM conkay_authored_tools WHERE status = 'proposed'`;
  const params = [];
  if (ownerId) { sql += ` AND owner_user_id = ?`; params.push(ownerId); }
  if (ownerOrgId) { sql += ` AND owner_org_id = ?`; params.push(ownerOrgId); }
  sql += ` ORDER BY proposed_at DESC`;
  try { return db.prepare(sql).all(...params); } catch { return []; }
}

export function getTool(db, toolId) {
  if (!db || !toolId) return null;
  try { return db.prepare(`SELECT * FROM conkay_authored_tools WHERE id = ?`).get(toolId) || null; } catch { return null; }
}

/**
 * Approve a proposed tool — the transition that makes it reachable by
 * ConKay's own tool-calling loop (spec §2b Tier 1). Self-approval is fine
 * for a private, self-scoped tool (the author already had raw code.dsl
 * access to run this exact logic manually — §0); the moment a tool is
 * org-scoped (Tier 2), the ORIGINAL AUTHOR approving their own proposal is
 * a real conflict of interest and is rejected — a different reviewer
 * (an org officer/admin) is required.
 */
export function approve(db, toolId, approverId) {
  if (!db || !toolId || !approverId) return { ok: false, reason: "missing_inputs" };
  const row = getTool(db, toolId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "proposed") return { ok: false, reason: "wrong_state", status: row.status };
  if (row.owner_type === "org" && approverId === row.owner_user_id) {
    return { ok: false, reason: "self_approval_conflict_of_interest" };
  }
  db.prepare(`
    UPDATE conkay_authored_tools
    SET status = 'approved', approved_at = unixepoch(), approved_by = ?
    WHERE id = ?
  `).run(approverId, toolId);
  return { ok: true, id: toolId, status: "approved" };
}

/** Reject a proposed or already-approved tool — never runs again either way. */
export function reject(db, toolId, approverId, reason) {
  if (!db || !toolId) return { ok: false, reason: "missing_inputs" };
  const row = getTool(db, toolId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "proposed" && row.status !== "approved") {
    return { ok: false, reason: "wrong_state", status: row.status };
  }
  db.prepare(`
    UPDATE conkay_authored_tools
    SET status = 'rejected', rejected_at = unixepoch(), rejected_by = ?, reject_reason = ?
    WHERE id = ?
  `).run(approverId || null, typeof reason === "string" ? reason.slice(0, 500) : null, toolId);
  return { ok: true, id: toolId, status: "rejected" };
}

/**
 * Revoke a previously-approved tool. Authorization: the author always; an
 * org officer/admin for an org-scoped tool via the caller-supplied
 * `opts.isPrivileged` predicate (the same "caller-supplied predicate"
 * pattern CLAUDE.md documents for world-organizations.js's isMember/
 * isOfficer/isLeader — a route/macro layer resolves the real officer check
 * and passes the boolean in; this lib never re-implements org role logic).
 * Per spec §4, does NOT halt any in-flight session — see
 * conkay-tool-invoke.js#invokeAuthoredTool for the per-call refusal this
 * produces on the very next dispatch.
 */
export function revoke(db, toolId, actorId, reason, opts = {}) {
  if (!db || !toolId || !actorId) return { ok: false, reason: "missing_inputs" };
  const row = getTool(db, toolId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "approved") return { ok: false, reason: "wrong_state", status: row.status };
  const authorized = actorId === row.owner_user_id || opts?.isPrivileged === true;
  if (!authorized) return { ok: false, reason: "not_authorized" };
  db.prepare(`
    UPDATE conkay_authored_tools
    SET status = 'revoked', revoked_at = unixepoch(), revoke_reason = ?
    WHERE id = ?
  `).run(typeof reason === "string" ? reason.slice(0, 500) : null, toolId);
  return { ok: true, id: toolId, status: "revoked" };
}

export default { propose, listPending, getTool, approve, reject, revoke };
