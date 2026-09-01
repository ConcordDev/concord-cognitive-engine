// server/lib/auth-gate/gates/sovereignty.js
//
// F0.5 gate wrapper — wraps the EXISTING sovereignty-invariants module.
// This file does NOT define new policy. It composes the existing one.

import { checkSovereigntyInvariants } from "../../../grc/sovereignty-invariants.js";

/**
 * Run the IMMUTABLE sovereignty hard veto. Returns:
 *   - {pass: true} if all invariants pass
 *   - {pass: false, severity, repair} on any invariant failure
 *
 * Per the locked precedence: a failed invariant here is a HARD VETO,
 * no other gate may override it.
 */
export async function check(envelope) {
  const operation = {
    type: inferOperationType(envelope.WHAT),
    requestingUser: envelope.WHO,
    dtu: envelope._internal?.args?.dtu || null,
    entity: envelope._internal?.args?.entity || null,
    targetDtu: envelope._internal?.args?.targetDtu || null,
    source: envelope._internal?.args?.source || null,
    userConsent: envelope._internal?.args?.userConsent ?? null,
    councilApproved: envelope._internal?.args?.councilApproved ?? false,
    newScope: envelope._internal?.args?.newScope || null,
  };

  try {
    const result = checkSovereigntyInvariants(operation);
    return {
      pass: result.pass === true,
      severity: result.severity || null,
      repair: result.repair || null,
      reason_code: result.pass ? "sovereignty_ok" : "sovereignty_hard_veto",
      invariant: result.name || null,
    };
  } catch (e) {
    return {
      pass: false,
      severity: "critical",
      repair: e?.message || String(e),
      reason_code: "sovereignty_threw",
    };
  }
}

function inferOperationType(toolName) {
  if (!toolName) return "unknown";
  if (toolName.startsWith("dtu_") || /dtu/i.test(toolName)) return "dtu_read";
  if (/scope|promote/i.test(toolName)) return "dtu_scope_change";
  if (/entity/i.test(toolName)) return "entity_read";
  if (/sync|sync/i.test(toolName)) return "dtu_sync";
  return "unknown";
}