// server/lib/auth-gate/gates/refusal.js
//
// F0.5 gate wrapper — wraps the EXISTING refusal-field module.
// Per the locked spec: refuses at state level (per-entity maturity, etc.).

import { isRefusedForDb, activeFields } from "../../refusal-field.js";

/**
 * Check refusal field state. Returns:
 *   - {pass: true} if no refusal applies
 *   - {pass: false, reason_code, fields} if any refusal applies
 */
export async function check(envelope, db = null) {
  if (!db) {
    // No DB available; cannot check refusal — pass with caveat
    return { pass: true, reason_code: "refusal_no_db_skip", fields: [] };
  }

  const worldId = envelope._internal?.args?.worldId || "default";
  const kind = inferRefusalKind(envelope.WHAT);
  const target = {
    entity_id: envelope.WHO,
    capability: envelope.WHAT,
  };

  try {
    const refused = isRefusedForDb(db, worldId, kind, target);
    const fields = activeFields(db ? { db } : null, worldId) || [];

    if (refused) {
      return {
        pass: false,
        reason_code: "refused_by_field",
        kind,
        fields: fields.slice(0, 10),
      };
    }
    return { pass: true, reason_code: "refusal_clear", fields: [] };
  } catch (e) {
    // Refusal DB missing/empty is not a denial
    return {
      pass: true,
      reason_code: "refusal_check_skipped",
      detail: e?.message || String(e),
    };
  }
}

function inferRefusalKind(toolName) {
  if (!toolName) return "default";
  if (/trade|order|fill/i.test(toolName)) return "trade";
  if (/write|create|update|delete/i.test(toolName)) return "write";
  if (/read|get|list|search/i.test(toolName)) return "read";
  return "default";
}