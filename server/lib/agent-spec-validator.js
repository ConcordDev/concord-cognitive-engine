// lib/agent-spec-validator.js
//
// Phase 13 (Stage C) — agent manifest validator.
//
// Validates the `concord-agent.json` shape end-to-end. Manual schema check
// (no new dep on ajv — codebase doesn't require it as a direct dep).
// Both MINT-time AND LOAD-time call this so drift between the persisted
// manifest and current spec gets caught.
//
// Spec:
//   id            string  e.g. "agent:spec:translator"
//   name          string  human label
//   version       string  semver-ish (no strict semver enforcement)
//   creator_id    string  who authored / owns the spec
//   license       enum    "MIT" | "CC-BY-SA-4.0" | "proprietary"
//   capabilities  array   [{ domain: string, macros: string[] }]
//   constraints   object  { max_concurrent_tasks?, memory_required_mb?, execution_timeout_s? }
//   parent_dtu_ids array  optional — for citation cascade on mint
//   description   string  optional
//   summary       string  optional (one-liner)

const ALLOWED_LICENSES = new Set(["MIT", "CC-BY-SA-4.0", "Apache-2.0", "proprietary"]);
const MAX_NAME_LEN = 120;
const MAX_DESC_LEN = 4000;
const MAX_CAPS = 32;
const MAX_MACROS_PER_CAP = 32;
const SAFE_ID_PATTERN = /^[a-z0-9._:\-/]{3,200}$/i;
const SAFE_DOMAIN_PATTERN = /^[a-z][a-z0-9_\-]*$/i;
const SAFE_MACRO_PATTERN = /^[a-z][a-z0-9_\-]*$/i;

function bad(reason, detail) { return { ok: false, reason, ...(detail ? { detail } : {}) }; }

/**
 * Validate an agent manifest. Returns { ok: true, normalized } on success
 * (with defaults stamped in) OR { ok: false, reason, detail }.
 */
export function validateAgentManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return bad("not_object");
  const m = manifest;

  if (typeof m.id !== "string" || !SAFE_ID_PATTERN.test(m.id)) {
    return bad("invalid_id", "must match /^[a-z0-9._:-/]{3,200}$/i");
  }
  if (typeof m.name !== "string" || m.name.length === 0 || m.name.length > MAX_NAME_LEN) {
    return bad("invalid_name", `1..${MAX_NAME_LEN} chars`);
  }
  if (typeof m.version !== "string" || m.version.length === 0 || m.version.length > 40) {
    return bad("invalid_version");
  }
  if (typeof m.creator_id !== "string" || m.creator_id.length === 0) {
    return bad("invalid_creator_id");
  }
  if (typeof m.license !== "string" || !ALLOWED_LICENSES.has(m.license)) {
    return bad("invalid_license", `must be one of ${[...ALLOWED_LICENSES].join(", ")}`);
  }
  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) {
    return bad("missing_capabilities");
  }
  if (m.capabilities.length > MAX_CAPS) {
    return bad("too_many_capabilities", `max ${MAX_CAPS}`);
  }
  for (const [i, cap] of m.capabilities.entries()) {
    if (!cap || typeof cap !== "object") return bad("invalid_capability_entry", `index ${i}`);
    if (typeof cap.domain !== "string" || !SAFE_DOMAIN_PATTERN.test(cap.domain)) {
      // "_llm" is a reserved capability domain that grants LLM access; allow it
      if (cap.domain !== "_llm") return bad("invalid_capability_domain", `index ${i}`);
    }
    if (!Array.isArray(cap.macros) || cap.macros.length === 0) {
      // _llm capability may declare an empty macros array (the domain itself is the grant)
      if (cap.domain !== "_llm") return bad("invalid_capability_macros", `index ${i}`);
    }
    if (Array.isArray(cap.macros) && cap.macros.length > MAX_MACROS_PER_CAP) {
      return bad("too_many_macros_per_capability", `index ${i}, max ${MAX_MACROS_PER_CAP}`);
    }
    for (const [j, mac] of (cap.macros || []).entries()) {
      if (typeof mac !== "string" || !SAFE_MACRO_PATTERN.test(mac)) {
        return bad("invalid_capability_macro_name", `capability ${i}.macros[${j}]`);
      }
    }
  }
  if (m.constraints != null) {
    if (typeof m.constraints !== "object") return bad("invalid_constraints");
    if (m.constraints.max_concurrent_tasks != null
        && (typeof m.constraints.max_concurrent_tasks !== "number"
            || m.constraints.max_concurrent_tasks < 1
            || m.constraints.max_concurrent_tasks > 1000)) {
      return bad("invalid_max_concurrent_tasks");
    }
    if (m.constraints.memory_required_mb != null
        && (typeof m.constraints.memory_required_mb !== "number"
            || m.constraints.memory_required_mb < 0
            || m.constraints.memory_required_mb > 65536)) {
      return bad("invalid_memory_required_mb");
    }
    if (m.constraints.execution_timeout_s != null
        && (typeof m.constraints.execution_timeout_s !== "number"
            || m.constraints.execution_timeout_s < 1
            || m.constraints.execution_timeout_s > 3600)) {
      return bad("invalid_execution_timeout_s");
    }
  }
  if (m.parent_dtu_ids != null) {
    if (!Array.isArray(m.parent_dtu_ids)) return bad("invalid_parent_dtu_ids");
    for (const [i, p] of m.parent_dtu_ids.entries()) {
      if (typeof p !== "string" || p.length === 0) return bad("invalid_parent_dtu_id_entry", `index ${i}`);
    }
  }
  if (m.description != null && (typeof m.description !== "string" || m.description.length > MAX_DESC_LEN)) {
    return bad("invalid_description");
  }
  if (m.summary != null && (typeof m.summary !== "string" || m.summary.length > 500)) {
    return bad("invalid_summary");
  }

  const normalized = {
    id: m.id,
    name: m.name,
    version: m.version,
    creator_id: m.creator_id,
    license: m.license,
    capabilities: m.capabilities.map((c) => ({
      domain: c.domain,
      macros: Array.isArray(c.macros) ? [...c.macros] : [],
    })),
    constraints: {
      max_concurrent_tasks: m.constraints?.max_concurrent_tasks ?? 1,
      memory_required_mb: m.constraints?.memory_required_mb ?? 0,
      execution_timeout_s: m.constraints?.execution_timeout_s ?? 60,
    },
    parent_dtu_ids: Array.isArray(m.parent_dtu_ids) ? [...m.parent_dtu_ids] : [],
    description: m.description || "",
    summary: m.summary || "",
  };
  return { ok: true, normalized };
}

/**
 * Build the SET of "<domain>.<macro>" strings the agent is allowed to call.
 * Returns a Set<string>. The "_llm" capability is represented as the literal
 * string "_llm" — callers check for it specifically.
 */
export function capabilitySet(manifest) {
  const out = new Set();
  for (const cap of manifest.capabilities || []) {
    if (cap.domain === "_llm") { out.add("_llm"); continue; }
    for (const mac of cap.macros || []) {
      out.add(`${cap.domain}.${mac}`);
    }
  }
  return out;
}
