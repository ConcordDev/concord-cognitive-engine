// server/lib/auth-gate/gates/rollback.js
//
// F0 gate #10 — Rollback spec required for write/high-risk mutations.

const MUTATION_TOOLS = new Set([
  "initiative_record_execution",
  "capability_register",
  "opportunity_approve",
  "opportunity_reject",
  "a2a_send",
  "research_invoke",
  "initiative_submit",
]);

/**
 * @param {object} envelope
 */
export async function check(envelope) {
  const isMutation = envelope.RISK === "write" || envelope.RISK === "high" || MUTATION_TOOLS.has(envelope.WHAT);
  const required = process.env.CONCORD_AUTH_GATE_ROLLBACK_REQUIRED === "true"
    || (isMutation && process.env.CONCORD_AUTH_GATE_MODE === "enforce");

  if (!required) {
    return { pass: true, reason_code: "rollback_not_required" };
  }

  if (!envelope.ROLLBACK || !envelope.ROLLBACK.kind) {
    return { pass: false, reason_code: "rollback_spec_missing", tool: envelope.WHAT };
  }

  return { pass: true, reason_code: "rollback_present", kind: envelope.ROLLBACK.kind };
}
