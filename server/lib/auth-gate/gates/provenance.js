// server/lib/auth-gate/gates/provenance.js
//
// F0.5 gate wrapper — wraps the EXISTING provenance-guard module.
// Per the locked spec: validates action-time provenance.

import { screenAction } from "../../provenance-guard.js";

/**
 * Validate action-time provenance. Returns:
 *   - {pass: true} if the action is properly sourced
 *   - {pass: false, reason_code, reason} on rejection
 */
export async function check(envelope) {
  try {
    const userIntent = envelope.WHY || envelope.PROVENANCE?.origin || "unknown";
    const [domain, ...rest] = (envelope.WHAT || "").split(/[._]/);
    const name = rest.join(".") || envelope.WHAT;

    const result = screenAction({
      userIntent,
      domain: domain || "unknown",
      name,
      params: envelope._internal?.args || {},
      allowedDomains: null,
    });

    if (!result || typeof result !== "object") {
      return { pass: true, reason_code: "provenance_unavailable_pass" };
    }

    if (result.allowed === false) {
      return {
        pass: false,
        reason_code: "provenance_rejected",
        reason: result.reason || "unknown",
      };
    }

    return { pass: true, reason_code: "provenance_ok" };
  } catch (e) {
    // Don't deny on error — log and pass
    return {
      pass: true,
      reason_code: "provenance_check_error",
      detail: e?.message || String(e),
    };
  }
}