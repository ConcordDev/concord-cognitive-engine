// server/lib/auth-gate/gates/resource.js
//
// F0 gate #9 — Resource/budget enforcement. Delegates to economic_check
// when financial budgets are set or when spend-risk tools are invoked.

const WRITE_TOOLS = new Set([
  "initiative_record_execution",
  "capability_register",
  "opportunity_approve",
  "opportunity_reject",
  "a2a_send",
  "research_invoke",
]);

/**
 * @param {object} envelope
 * @param {object} [ctx]
 */
export async function check(envelope, ctx = {}) {
  const financial = envelope.RESOURCE?.financial_budget;
  const hasBudgetField = financial != null && financial !== "";
  const spendRisk = envelope.RISK === "write" || envelope.RISK === "high" || WRITE_TOOLS.has(envelope.WHAT);
  const budgetCheckEnabled = process.env.CONCORD_AUTH_GATE_BUDGET_CHECK === "true"
    || hasBudgetField
    || (spendRisk && process.env.CONCORD_AUTH_GATE_MODE === "enforce");

  if (!budgetCheckEnabled) {
    return { pass: true, reason_code: "budget_check_skipped" };
  }

  try {
    const { callMCPTool } = await import("../../mcp-tools.js");
    const raw = await callMCPTool(ctx.db, "economic_check", {}, ctx.STATE || globalThis.STATE || null);
    const obs = raw?.result?.observation || raw?.observation || {};
    const safe = obs.safe_to_proceed !== false && obs.budget_action !== "halt_optional";
    if (!safe) {
      return {
        pass: false,
        reason_code: "budget_exceeded",
        budget_action: obs.budget_action,
        budget_reason: obs.budget_reason,
      };
    }
    return { pass: true, reason_code: "budget_ok", budget_action: obs.budget_action };
  } catch (e) {
    return { pass: true, reason_code: "budget_check_unavailable", detail: e?.message };
  }
}
