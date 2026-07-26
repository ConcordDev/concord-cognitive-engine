// server/lib/conkay-tool-invoke.js
//
// First-buildable slice of docs/CONKAY_TOOL_AUTHORING_SPEC.md §7 point 3 —
// dispatch a previously-approved, non-revoked authored tool.
//
// Every rule below is load-bearing per the spec, not incidental style:
//
//   - Fresh DB read, no cache, on EVERY call (§4's freshness discipline,
//     mirroring agent-marathon.js#createToolGate's own comment: "a revoke
//     landing mid-tick... stops the very next tool dispatch, not just the
//     next tick"). This function never memoizes a tool's approved/revoked
//     verdict across calls.
//   - The confined ctx is built from the row's OWN stored `manifest_json`
//     — NEVER from anything the current caller supplies (§3 point 1). This
//     is the one place authored-tool dispatch must NOT copy `code.dsl`'s
//     existing caller-supplied-manifest behavior (server/domains/code.js).
//   - The refusal contract mirrors agent-marathon.js#createToolGate's
//     two-tier shape: `{ ok:false, halt:false, reason }` — refuse just
//     THIS call, never a session-level halt. A revoked/unauthorized/
//     unknown tool is a per-call capability check, not a governance-budget
//     event (§4).
//
// ── Design call: NOT reusing loader.js's `buildSandboxedContext` verbatim ──
//
// The spec's §7 point 3 literally says `hostCtx = buildSandboxedContext(
// STATE, toolId, { runMacro, manifest: {...} })`. Reading that function
// (server/plugins/loader.js:439-526) closely: it re-wraps the given
// `runMacro` through its OWN `makeConfinedCtx({ userId: 'plugin:' + pluginId,
// ... })` call — i.e. it re-confines using a SYNTHETIC actor identity keyed
// to the plugin/tool id, not the real caller. That is correct for a genuine
// plugin (which acts on behalf of the system generically, with no single
// human "owner" per call) but WRONG for an authored tool: a macro handler
// downstream (e.g. `dtu.create`) attributes creation to `ctx.actor.userId`,
// and misattributing every DTU an authored tool creates to a synthetic
// `plugin:<toolId>` identity instead of the real human owner/caller would be
// a silent authorship bug — worse, it would double-confine (this module
// already builds a `makeConfinedCtx` scoped to the real caller below;
// wrapping THAT again through `buildSandboxedContext`'s internal
// `makeConfinedCtx` would layer a second, differently-scoped confinement on
// top for no benefit).
//
// So for the `sandboxed_code` kind, this module builds a same-SHAPED host
// ctx by hand (getDTU/getDTUCount/getEmergent/callMacro/log/store.*/
// getRateLimit — the exact contract `bridgeFromHostCtx` expects) whose
// `callMacro` is this module's own already-correctly-scoped
// `confined.runMacro` directly — no second confinement layer, correct actor
// identity preserved end to end. `bridgeFromHostCtx` and `PluginSandbox`
// themselves are used completely unmodified, exactly as the spec directs.

import { makeConfinedCtx } from "./confined-ctx.js";
import { runDsl } from "./dsl.js";
import { PluginSandbox, bridgeFromHostCtx } from "./plugin-sandbox.js";
import { getOrgMembers } from "./world-organizations.js";

function extractGrants(manifestJson) {
  let parsed;
  try { parsed = JSON.parse(manifestJson || "[]"); } catch { parsed = []; }
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.macros)) return parsed.macros;
  return [];
}

function typeMatches(value, type) {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    default: return true;
  }
}

/** Minimal JSON-schema-lite check ({type, properties, required}), per spec §1c. */
function validateAgainstSchema(input, schema) {
  const errors = [];
  if (!schema || typeof schema !== "object") return { ok: true, errors };
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    errors.push("input_must_be_object");
    return { ok: false, errors };
  }
  for (const req of Array.isArray(schema.required) ? schema.required : []) {
    if (!(req in input)) errors.push(`missing_required_field:${req}`);
  }
  if (schema.properties && typeof schema.properties === "object") {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!(key in input)) continue;
      const expected = propSchema?.type;
      if (expected && !typeMatches(input[key], expected)) {
        errors.push(`type_mismatch:${key}:expected_${expected}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Same-shaped host ctx as loader.js#buildSandboxedContext, but with the
 * REAL caller's already-confined runMacro wired straight through as
 * `callMacro` — see the design-call note above for why this is hand-built
 * rather than a verbatim call into loader.js's version. */
function buildAuthoredToolHostCtx({ toolId, db, confinedRunMacro }) {
  const localStore = new Map();
  return Object.freeze({
    pluginId: toolId,
    getDTU(id) {
      try {
        const row = db?.prepare?.(`SELECT * FROM dtus WHERE id = ?`).get(id);
        return row ? Object.freeze({ ...row }) : null;
      } catch { return null; }
    },
    getDTUCount() {
      try { return db?.prepare?.(`SELECT COUNT(*) AS c FROM dtus`).get()?.c || 0; } catch { return 0; }
    },
    // Emergent-state peek is not wired for authored tools in this first
    // slice — honest absence (null), never fabricated.
    getEmergent() { return null; },
    callMacro: (domain, name, input) => confinedRunMacro(domain, name, input),
    log() { /* best-effort no-op — no STATE.logs ring buffer wired here yet */ },
    store: {
      get: (k) => localStore.get(k),
      set: (k, v) => { localStore.set(k, v); return true; },
      has: (k) => localStore.has(k),
      delete: (k) => localStore.delete(k),
      clear: () => localStore.clear(),
    },
    getRateLimit() { return { remaining: Infinity }; },
  });
}

/**
 * Invoke an approved, non-revoked authored tool.
 *
 * @param {object} db
 * @param {string} toolId
 * @param {object} input
 * @param {object} opts
 * @param {Function} opts.runMacro  the REAL runMacro(domain,name,input,ctx) (DI)
 * @param {object}   [opts.llm]
 * @param {string}   opts.callerId  the acting user's id — authorization + the
 *                                  confined actor identity every macro call
 *                                  downstream sees.
 * @returns {Promise<{ok, halt, toolId, kind?, result?, trace?, error?, reason?}>}
 */
export async function invokeAuthoredTool(db, toolId, input, opts = {}) {
  const { runMacro, llm, callerId } = opts || {};
  if (!db || !toolId) return { ok: false, halt: false, reason: "missing_inputs" };
  if (!callerId) return { ok: false, halt: false, reason: "unauthenticated" };
  if (typeof runMacro !== "function") return { ok: false, halt: false, reason: "runMacro_required" };

  // Fresh read, no cache — revocation must win on the very next dispatch.
  let row;
  try {
    row = db.prepare(`SELECT * FROM conkay_authored_tools WHERE id = ?`).get(toolId);
  } catch (err) {
    return { ok: false, halt: false, reason: `lookup_failed: ${err?.message || err}` };
  }
  if (!row) return { ok: false, halt: false, reason: `tool_not_found:${toolId}` };

  // Per-call capability check, never a session-level halt (spec §4).
  if (row.revoked_at) {
    return { ok: false, halt: false, reason: `tool_revoked:${toolId}` };
  }
  if (row.status !== "approved") {
    return { ok: false, halt: false, reason: `tool_not_approved:${toolId}:${row.status}` };
  }

  const isOwner = row.owner_user_id === callerId;
  let isOrgMember = false;
  if (!isOwner && row.owner_type === "org" && row.owner_org_id) {
    try {
      isOrgMember = getOrgMembers(db, row.owner_org_id).some((m) => m.userId === callerId);
    } catch { isOrgMember = false; }
  }
  if (!isOwner && !isOrgMember) {
    return { ok: false, halt: false, reason: `tool_not_authorized:${toolId}` };
  }

  let inputSchema = null;
  try { inputSchema = row.input_schema_json ? JSON.parse(row.input_schema_json) : null; } catch { inputSchema = null; }
  if (inputSchema) {
    const schemaCheck = validateAgainstSchema(input, inputSchema);
    if (!schemaCheck.ok) {
      return { ok: false, halt: false, reason: `input_schema_violation:${schemaCheck.errors.join(",")}` };
    }
  }

  const grants = extractGrants(row.manifest_json);

  // The row's OWN stored manifest — never anything the current caller
  // supplies (spec §3 point 1, the deliberate divergence from code.dsl).
  const confined = makeConfinedCtx({ userId: callerId, runMacro, llm, db, manifest: { macros: grants } });

  if (row.kind === "dsl") {
    const result = await runDsl(row.source, { runMacro: confined.runMacro });
    return {
      ok: result.ok, halt: false, toolId, kind: "dsl",
      result: result.result, trace: result.trace,
      error: result.error, phase: result.phase,
    };
  }

  if (row.kind === "sandboxed_code") {
    const hostCtx = buildAuthoredToolHostCtx({ toolId, db, confinedRunMacro: confined.runMacro });
    const sandbox = new PluginSandbox({ pluginId: toolId, sourceCode: row.source, bridge: bridgeFromHostCtx(hostCtx) });
    try {
      const shape = await sandbox.load();
      if (shape?.hasInit) await sandbox.callInit();
      // Entrypoint convention: a macro named "<namespace>.run" if present,
      // else the first declared macro. Documented, not silently guessed —
      // an authored sandboxed_code tool with no macros has no entrypoint.
      const macroNames = shape?.macroNames || [];
      const entry = macroNames.find((n) => n.endsWith(".run")) || macroNames[0];
      if (!entry) {
        return { ok: false, halt: false, toolId, kind: "sandboxed_code", reason: "sandboxed_tool_no_entrypoint" };
      }
      const value = await sandbox.callMacroHandler(entry, input || {});
      return { ok: true, halt: false, toolId, kind: "sandboxed_code", result: value };
    } catch (err) {
      return { ok: false, halt: false, toolId, kind: "sandboxed_code", reason: `sandboxed_tool_error: ${err?.message || err}` };
    } finally {
      try { await sandbox.destroy(); } catch { /* best effort */ }
    }
  }

  return { ok: false, halt: false, reason: `unknown_kind:${row.kind}` };
}

export default { invokeAuthoredTool };
