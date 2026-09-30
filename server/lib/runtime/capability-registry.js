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

import fs from "node:fs";

/** @type {Map<string, object>} capability name ("domain.action") -> descriptor */
const REGISTRY = new Map();

// Owner -> {organLabel, path} for every domain currently registering an
// implementation:"mcp" capability (verified via
// `grep -rn 'owner: "' server/domains/{incident-engine,opportunity-engine,
// research-frontier,trace-fabric,browser-organ}.js`, 2026-09-05). `path`
// duplicates server/lib/mcp-tools.js's ORGANS map values by necessity — this
// module cannot statically import that large, dependency-heavy file without
// risking a heavy/circular import into a registry meant to be safely
// importable from anywhere (the same reason the retired
// `globalThis.__concordMcpTools` indirection existed in the first place).
// The duplication is pinned bidirectionally by
// tests/runtime/capability-registry-organ-paths.test.js, which fails if this
// map's paths ever disagree with the live ORGANS map — so a future organ
// relocation that forgets to update both sides is caught, not silent.
// `organLabel` is the exact 4th-argument string each xCall wrapper in
// mcp-tools.js passes to organCall (NOT a mechanical transform of `owner` —
// trace_fabric_organ -> "trace-fabric", not "trace-fabric-organ", is why this
// is an explicit table rather than a computed one).
//
// New organ domain? Add its {owner: {organLabel, path}} entry here too.
const MCP_ORGAN_OWNERS = {
  browser_organ: { organLabel: "browser-organ", path: "/Users/dutch/.local/bin/browser-organ.py" },
  incident_engine: { organLabel: "incident-engine", path: "/Users/dutch/.local/bin/incident-engine.py" },
  opportunity_engine: { organLabel: "opportunity-engine", path: "/Users/dutch/.local/bin/opportunity-engine.py" },
  research_frontier: { organLabel: "research-frontier", path: "/Users/dutch/.local/bin/research-frontier.py" },
  trace_fabric_organ: { organLabel: "trace-fabric", path: "/Users/dutch/.local/bin/trace-fabric.py" },
};

// 2026-09-05: added "execute" between "write" and "high". Two real
// capabilities (incident.recover, research.invoke) had been registering
// with risk:"execute" since they were written — a value RISK_TIERS never
// contained — so every call to registerCapability() for them returned
// {ok:false, reason:"invalid_risk_tier"} and they were silently absent from
// the registry, never actually failing loudly anywhere a caller would
// notice. Semantics taken from how those two capabilities' own descriptions
// already used the word, and from the SEPARATE (pre-existing, unrelated to
// this registry) auth-gate authority model — server/lib/auth-gate already
// treats `execute` as one of its authority flags
// (observe/read/write/execute/trade/deploy/code/destructive), distinct from
// and below trade/deploy/code/destructive — so this slots the registry's
// risk vocabulary in line with a distinction the rest of the system already
// draws, not a new invention: "write" mutates STATE (a row, a record, an
// internal value); "execute" triggers a bounded real-world ACTION with its
// own side effects outside a simple state mutation (running a recovery
// procedure, invoking a paid LLM call) but does not itself require the
// explicit human sign-off "high" does.
export const RISK_TIERS = /** @type {const} */ (["read", "compute", "write", "execute", "high"]);

/**
 * @typedef {object} CapabilityDescriptor
 * @property {string} capability   "domain.action", must match a real LENS_ACTIONS
 *   or MACROS registration (checked, not trusted — see health()).
 * @property {string} owner        Which subsystem/domain owns this (e.g. "predict").
 * @property {string} [description]
 * @property {string[]} [inputs]   Named input fields, informational.
 * @property {string[]} [outputs]  Named output fields, informational.
 * @property {"read"|"compute"|"write"|"execute"|"high"} risk  See RISK_TIERS.
 *   "write" = mutates internal state only. "execute" = triggers a bounded
 *   real-world action with its own side effects (a recovery procedure, a
 *   paid LLM invocation) that does NOT require explicit human sign-off —
 *   see incident.recover / research.invoke for the two capabilities this
 *   tier was added for. "high" = DOES require explicit human authorization
 *   to have any real-world effect (the predict.promoteAuthority shape — see
 *   capability-lifecycle.js).
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
  // MCP tools (registered as `<tool_name>` not `<domain>.<action>`) are
  // standalone Python MCP servers, spawned per-call by mcp-tools.js's
  // organCall() (see server/lib/mcp-tools.js's ORGANS map). Verified against
  // the real script file, not assumed.
  //
  // 2026-09-05 fix: this branch used to consult `globalThis.__concordMcpTools`,
  // a Set that NOTHING in the codebase ever populated (write-side never
  // existed — only this one read site did) — so it always fell through to a
  // fallback, `RISKS_THAT_GET_MCP_ASSUMPTION`, that unconditionally reported
  // reachable:true for every read/write/execute-risk mcp capability, forever.
  // That fallback was meant to cover a brief boot-time race before the Set
  // populated; since the Set never populated, the "brief" race was permanent.
  // All 5 organ domains registered at the time happened to have real backing
  // scripts, so the bug was silent in practice — but health-check could not
  // have told you if one went missing, which defeats the entire point of a
  // health check. Fixed to check the actual file on disk; the Set and the
  // risk-based fallback are both retired, not just patched.
  if (descriptor.implementation === "mcp") {
    const entry = MCP_ORGAN_OWNERS[descriptor.owner];
    if (!entry) {
      // An mcp-implementation capability whose owner isn't a known organ.
      // Honest failure, not a guess — extend MCP_ORGAN_OWNERS when a new
      // organ domain is registered (see the map's own comment).
      return { ok: true, reachable: false, reason: "mcp_owner_not_mapped" };
    }
    // Mirrors organCall's own `process.env[organLabel + "_PATH"] || organPath`
    // resolution exactly, so an operator's env override is honoured here too
    // — otherwise health-check could report "missing" for an organ that was
    // deliberately relocated via env var and is actually fine.
    const effectivePath = process.env[`${entry.organLabel}_PATH`] || entry.path;
    return fs.existsSync(effectivePath)
      ? { ok: true, reachable: true }
      : { ok: true, reachable: false, reason: "organ_script_missing", path: effectivePath };
  }
  return { ok: true, reachable: false, reason: "handler_not_found_in_lens_actions_or_macros" };
}

/** @internal Test-only — clear the registry between test files. */
export function _resetRegistry() {
  REGISTRY.clear();
}

/** @internal Test-only — read access for the drift-guard against
 * mcp-tools.js's ORGANS map (tests/runtime/capability-registry-organ-paths.test.js). */
export function _mcpOrganOwnersForTest() {
  return MCP_ORGAN_OWNERS;
}
