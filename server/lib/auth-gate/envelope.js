// server/lib/auth-gate/envelope.js
//
// F0.4 — Build the 14-field Authority Envelope around an MCP tool call.
//
// Per the locked spec (F0.0 + F0.2):
//   WHO, WHAT, WHY, SCOPE, RESOURCE, RISK, AUTHORITY, EXPIRATION,
//   PRECONDITIONS, VERIFICATION, ROLLBACK, PROVENANCE, TRACE_ID, DECISION
//
// Auth-gate is the orchestrator; this file only CONSTRUCTS the envelope.
// Policy lives in the existing authority systems (sovereignty-invariants,
// capability-registry, refusal-field, provenance-guard, governance/constitution).

import { randomUUID } from "node:crypto";

/**
 * Default TTL for ad-hoc envelopes (no EXPIRATION set explicitly).
 * Initiatives use 24h, ad-hoc uses 5min.
 */
export const DEFAULT_TTL_MS = {
  AD_HOC: 5 * 60 * 1000,        // 5 minutes
  INITIATIVE: 24 * 60 * 60 * 1000,  // 24 hours
  SCHEDULED_JOB: 24 * 60 * 60 * 1000,
  PROACTIVE: 60 * 60 * 1000,     // 1 hour
  REPAIR: 30 * 60 * 1000,        // 30 minutes
  EXTERNAL_AGENT: 60 * 1000,     // 1 minute
};

/**
 * Risk → minimum required capability lattice.
 * Per locked spec: higher capability does NOT imply lower.
 */
export const RISK_TO_AUTHORITY = {
  read:     { observe: true, read: true, write: false, execute: false, trade: false, deploy: false, code: false, destructive: false },
  compute:  { observe: true, read: true, write: false, execute: false, trade: false, deploy: false, code: false, destructive: false },
  write:    { observe: true, read: true, write: true,  execute: false, trade: false, deploy: false, code: false, destructive: false },
  high:     { observe: true, read: true, write: true,  execute: true,  trade: true,  deploy: true,  code: true,  destructive: true  },
};

/**
 * Generate a TRACE_ID for correlation with the Trace Fabric (F3 deliverable).
 * Honors an incoming X-Trace-Id header if present (OTel pass-through).
 */
export function newTraceId(incomingId = null) {
  return incomingId || randomUUID();
}

/**
 * Build an Authority Envelope around an MCP tool call.
 *
 * @param {Object} input
 * @param {string} input.tool              — The tool name (snake_case MCP name)
 * @param {Object} input.args              — The tool's arguments
 * @param {Object} input.ctx               — Express req + actor
 * @param {string} [input.why]             — initiative_id | opportunity_id | proactive_id | incident_id | repair_id | scheduled_job_id | null
 * @param {Object} [input.provenance]      — Override or augment provenance
 * @param {Object} [input.preconditions]   — Caller-provided state checks
 * @param {Object} [input.verification]    — Post-condition probe spec
 * @param {Object} [input.rollback]        — Undo spec (required for mutations)
 * @param {Object} [input.resource]        — Budget caps
 * @param {number} [input.ttlMs]           — Override default TTL
 * @returns {Object} The 14-field envelope
 */
export function buildEnvelope(input) {
  if (!input || typeof input !== "object") {
    throw new Error("buildEnvelope: input must be an object");
  }
  if (!input.tool || typeof input.tool !== "string") {
    throw new Error("buildEnvelope: tool (string) is required");
  }

  const actor = input.ctx?.actor || input.ctx?.user || null;
  const origin = inferOrigin(input.why, input.provenance);

  // Trace ID — honor incoming for OTel pass-through
  const trace_id = newTraceId(input.ctx?.trace_id || input.provenance?.parent_trace_id);

  // TTL — default per origin, overridable
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS[origin.toUpperCase()] ?? DEFAULT_TTL_MS.AD_HOC;
  const expiration = new Date(Date.now() + ttlMs).toISOString();

  // Actor chain — append this caller to the chain
  const actor_chain = Array.isArray(input.provenance?.actor_chain)
    ? [...input.provenance.actor_chain, actor?.id || "anonymous"]
    : [actor?.id || "anonymous"];

  return Object.freeze({
    // 1. WHO — entity/actor/user
    WHO: actor?.id || actor?.userId || "anonymous",

    // 2. WHAT — tool name (snake_case MCP) + canonical capability
    WHAT: input.tool,

    // 3. WHY — initiative / opportunity / proactive / incident / repair / scheduled / null
    WHY: input.why ?? null,

    // 4. SCOPE — resource paths
    SCOPE: input.scope ?? [],

    // 5. RESOURCE — structured budgets
    RESOURCE: Object.freeze({
      compute_budget: input.resource?.compute_budget ?? null,
      financial_budget: input.resource?.financial_budget ?? null,
      network_budget: input.resource?.network_budget ?? null,
      storage_budget: input.resource?.storage_budget ?? null,
      time_budget: input.resource?.time_budget ?? null,
      tool_budget: input.resource?.tool_budget ?? null,
    }),

    // 6. RISK — read | compute | write | high (filled by capability gate, default read)
    RISK: "read",

    // 7. AUTHORITY — capability lattice (filled by capability gate; default read-only)
    AUTHORITY: Object.freeze({ ...RISK_TO_AUTHORITY.read }),

    // 8. EXPIRATION — ISO timestamp
    EXPIRATION: expiration,

    // 9. PRECONDITIONS — state checks
    PRECONDITIONS: input.preconditions ?? {},

    // 10. VERIFICATION — post-condition probe spec
    VERIFICATION: input.verification ?? null,

    // 11. ROLLBACK — undo spec
    ROLLBACK: input.rollback ?? null,

    // 12. PROVENANCE — origin + chain
    PROVENANCE: Object.freeze({
      origin,
      parent_trace_id: input.provenance?.parent_trace_id ?? null,
      created_at: new Date().toISOString(),
      actor_chain: Object.freeze(actor_chain),
      initiator: actor?.id || "anonymous",
    }),

    // 13. TRACE_ID — uuid
    TRACE_ID: trace_id,

    // 14. DECISION — populated by evaluate(); null until decided
    DECISION: null,

    // Internal: pass through args + ctx for downstream gates
    _internal: Object.freeze({
      tool: input.tool,
      args: input.args ?? {},
      ctx: input.ctx ?? {},
      capability_descriptor: null, // filled by capability gate
    }),
  });
}

/**
 * Infer origin from WHY or PROVENANCE.
 * WHY is an ID (string) — the prefix indicates origin.
 * PROVENANCE.origin takes precedence if both are present.
 */
function inferOrigin(why, provenance) {
  if (provenance?.origin) return provenance.origin;
  if (!why || typeof why !== "string") return "user";
  if (why.startsWith("init_")) return "initiative";
  if (why.startsWith("opp_")) return "opportunity";
  if (why.startsWith("pro_")) return "proactive";
  if (why.startsWith("inc_")) return "incident";
  if (why.startsWith("rep_")) return "repair";
  if (why.startsWith("job_")) return "scheduled_job";
  if (why.startsWith("ext_")) return "external_agent";
  return "user";
}

/**
 * Validate that an envelope has the required 14 fields.
 * Used by independent evaluator (F0.6).
 */
export function hasAllEnvelopeFields(envelope) {
  const required = [
    "WHO", "WHAT", "WHY", "SCOPE", "RESOURCE", "RISK", "AUTHORITY",
    "EXPIRATION", "PRECONDITIONS", "VERIFICATION", "ROLLBACK",
    "PROVENANCE", "TRACE_ID", "DECISION",
  ];
  for (const f of required) {
    if (!(f in envelope)) return false;
  }
  return true;
}

/**
 * Apply a decision to an envelope, returning a new envelope with DECISION populated.
 * Original envelope is frozen; returns a new frozen object.
 */
export function applyDecision(envelope, decision) {
  if (!envelope || !decision) throw new Error("applyDecision: envelope and decision required");
  if (!["ALLOW", "DENY", "DEFER", "OBSERVE", "ESCALATE"].includes(decision.decision_type)) {
    throw new Error(`applyDecision: invalid decision_type ${decision.decision_type}`);
  }
  return Object.freeze({
    ...envelope,
    DECISION: Object.freeze({
      decision_id: decision.decision_id || randomUUID(),
      decision_type: decision.decision_type,
      policy_result: decision.policy_result ?? null,
      confidence: typeof decision.confidence === "number" ? decision.confidence : 1.0,
      reason_code: decision.reason_code ?? "unspecified",
      decided_at: new Date().toISOString(),
      decided_by: decision.decided_by ?? "system",
    }),
  });
}