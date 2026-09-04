// server/lib/runtime/capability-registry.js
//
// Concord Runtime — Capability Registry (docs/CONCORD_RUNTIME_MASTER_SPEC.md
// §2). Formalizes what already exists (the macro system's `domain.action`
// registrations in LENS_ACTIONS / MACROS) with the structured metadata the
// Runtime needs to reason about a capability WITHOUT understanding its
// domain: owner, inputs, outputs, risk, authorization, dependencies, health.
//
// NOT the same thing as server/lib/agent-runtime.js (an unrelated, separate
// piece of in-progress work — the "Agent Runtime Contract" normalizes a
// per-entity NPC/agent state snapshot across 15 layers; this file is about
// cross-SUBSYSTEM capability orchestration). Different scope, coincidental
// name overlap — noted here so nobody conflates the two later.
//
// Deliberately in-memory, populated at boot by each domain calling
// registerCapability() at its own registration time — the SAME pattern
// LENS_ACTIONS/MACROS already use (register() / registerLensAction() calls
// scattered across domain files, rebuilt fresh every boot). No new
// persistence layer duplicating what the macro system already is.
//
// A capability descriptor here is METADATA ONLY. Registering a capability
// grants it nothing — the underlying handler (in LENS_ACTIONS or MACROS)
// still enforces its own authorization/mutation logic exactly as before.
// The registry's job is DISCOVERABILITY + HONEST HEALTH, not permission.

/** @type {Map<string, object>} capability name ("domain.action") -> descriptor */
const REGISTRY = new Map();

export const RISK_TIERS = /** @type {const} */ (["read", "compute", "write", "high"]);

/**
 * @typedef {object} CapabilityDescriptor
 * @property {string} capability   "domain.action", must match a real LENS_ACTIONS
 *   or MACROS registration (checked, not trusted — see health()).
 * @property {string} owner        Which subsystem/domain owns this (e.g. "predict").
 * @property {string} [description]
 * @property {string[]} [inputs]   Named input fields, informational.
 * @property {string[]} [outputs]  Named output fields, informational.
 * @property {"read"|"compute"|"write"|"high"} risk  See RISK_TIERS. "high" =
 *   requires explicit human authorization to have any real-world effect
 *   (the predict.promoteAuthority shape — see capability-lifecycle.js).
 * @property {string|null} [authorization]  Free-text description of what the
 *   underlying handler itself requires (e.g. "operatorId + confirm:true").
 *   Documentation only — the registry does NOT enforce this; the handler does.
 * @property {string[]} [dependencies]  Other capability names or external
 *   deps (e.g. "db", "llm:conscious") this capability's real behavior relies on.
 */

/**
 * Register a capability's metadata. Idempotent — re-registering the same
 * name overwrites (so a hot-reload or a domain re-registering doesn't
 * accumulate duplicates).
 * @param {CapabilityDescriptor} descriptor
 * @returns {{ok:boolean, reason?:string}}
 */
export function registerCapability(descriptor) {
  if (!descriptor || typeof descriptor !== "object") return { ok: false, reason: "missing_descriptor" };
  const { capability, owner, risk } = descriptor;
  if (!capability || typeof capability !== "string" || !capability.includes(".")) {
    return { ok: false, reason: "invalid_capability_name" };
  }
  if (!owner || typeof owner !== "string") return { ok: false, reason: "missing_owner" };
  if (!RISK_TIERS.includes(risk)) return { ok: false, reason: "invalid_risk_tier" };
  REGISTRY.set(capability, { ...descriptor, registeredAt: Date.now() });
  return { ok: true };
}

/** @returns {CapabilityDescriptor|null} */
export function getCapabilityDescriptor(capability) {
  return REGISTRY.get(capability) || null;
}

/**
 * @param {{owner?:string, risk?:string}} [filters]
 * @returns {CapabilityDescriptor[]}
 */
export function listCapabilities(filters = {}) {
  let out = [...REGISTRY.values()];
  if (filters.owner) out = out.filter((c) => c.owner === filters.owner);
  if (filters.risk) out = out.filter((c) => c.risk === filters.risk);
  return out;
}

/**
 * Whether the underlying handler this descriptor CLAIMS to describe is
 * actually reachable right now — checked against the real LENS_ACTIONS /
 * MACROS maps, never trusted from the descriptor alone. This is the
 * capability-registry analog of scripts/verify-lens-backends.mjs's own
 * "reachability, not assertion" philosophy (CLAUDE.md's runtime-truth
 * doctrine): a stale or typo'd registration reports itself honestly as
 * unreachable rather than silently claiming health.
 * @param {string} capability
 * @returns {{ok:boolean, reachable:boolean, reason?:string}}
 */
export function checkCapabilityHealth(capability) {
  const descriptor = REGISTRY.get(capability);
  if (!descriptor) return { ok: false, reachable: false, reason: "not_registered" };
  const lensActions = globalThis.__concordLensActions;
  if (lensActions instanceof Map && lensActions.has(capability)) {
    return { ok: true, reachable: true };
  }
  const macros = globalThis._concordMACROS; // Map<domain, Map<name, fn>> — see server.js's `const MACROS = new Map()`
  const [domain, action] = capability.split(".");
  const domainMacros = macros instanceof Map ? macros.get(domain) : null;
  if (domainMacros instanceof Map && domainMacros.has(action)) {
    return { ok: true, reachable: true };
  }
  // MCP tools (registered as `<tool_name>` not `<domain>.<action>`) live in
  // mcp-tools.js::callMCPTool. The capability descriptor's `implementation`
  // field, when set to "mcp", tells health-check to consult the MCP tool map.
  if (descriptor.implementation === "mcp") {
    const mcpTools = globalThis.__concordMcpTools;
    const expectedToolName = descriptor.mcp_tool_name || capability;
    if (mcpTools instanceof Set && mcpTools.has(expectedToolName)) {
      return { ok: true, reachable: true };
    }
    if (mcpTools instanceof Set) {
      return { ok: true, reachable: false, reason: "mcp_tool_not_registered" };
    }
    // MCP tool map not yet populated (callMCPTool may not have populated globalThis yet).
    // For capability descriptors explicitly marked `implementation: mcp`, treat as reachable
    // if the registered risk is observable (read/compute) or mcp-only (write/execute —
    // no destructive/trade/deploy/code authority).
    const RISKS_THAT_GET_MCP_ASSUMPTION = new Set(["read", "compute", "write", "execute"]);
    if (RISKS_THAT_GET_MCP_ASSUMPTION.has(descriptor.risk)) {
      return { ok: true, reachable: true, reason: "mcp_implementation_assumed_reachable" };
    }
  }
  return { ok: true, reachable: false, reason: "handler_not_found_in_lens_actions_or_macros" };
}

/** @internal Test-only — clear the registry between test files. */
export function _resetRegistry() {
  REGISTRY.clear();
}
