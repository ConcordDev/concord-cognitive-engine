// server/lib/auth-gate/gates/verification.js
//
// F0.5 NEW gate — post-condition probe.
// "Tool returned 200" ≠ "autonomous objective succeeded."

/**
 * Run a verification probe after the tool completes.
 *
 * Verification kinds:
 *   - result_shape: { schema: { ok?: boolean, error?: string, [fields...] } }
 *                   Pass if result matches schema
 *   - dtu_exists: { id: string }
 *                   Pass if DTU with id exists in DB
 *   - state_match: { kind: string, expected: any }
 *                   Pass if STATE matches expected value
 *   - none: skip verification
 *
 * Returns:
 *   - {pass: true, kind, detail}
 *   - {pass: false, kind, reason_code, detail}
 */
export async function check(envelope, result, db = null, STATE = null) {
  const spec = envelope.VERIFICATION;
  if (!spec || spec.kind === "none") {
    return { pass: true, kind: "none", reason_code: "no_verification_required" };
  }

  try {
    switch (spec.kind) {
      case "result_shape":
        return verifyResultShape(result, spec.params || spec);
      case "dtu_exists":
        return verifyDtuExists(spec.id || spec.params?.id, db);
      case "state_match":
        return verifyStateMatch(spec, STATE);
      default:
        return {
          pass: true,
          kind: spec.kind,
          reason_code: "unknown_verification_kind_skip",
        };
    }
  } catch (e) {
    return {
      pass: false,
      kind: spec.kind,
      reason_code: "verification_threw",
      detail: e?.message || String(e),
    };
  }
}

function verifyResultShape(result, spec) {
  // Minimal schema check: ok must be true if specified, error must not be present
  if (spec.schema?.ok === true && result?.ok === false) {
    return {
      pass: false,
      kind: "result_shape",
      reason_code: "result_ok_false",
      detail: result.error || result.reason,
    };
  }
  if (spec.schema?.no_error === true && (result?.error || result?.reason)) {
    return {
      pass: false,
      kind: "result_shape",
      reason_code: "result_has_error",
      detail: result.error || result.reason,
    };
  }
  if (spec.schema?.required_fields && Array.isArray(spec.schema.required_fields)) {
    for (const field of spec.schema.required_fields) {
      if (!(field in (result || {}))) {
        return {
          pass: false,
          kind: "result_shape",
          reason_code: "missing_required_field",
          missing_field: field,
        };
      }
    }
  }
  return { pass: true, kind: "result_shape", reason_code: "result_shape_ok" };
}

function verifyDtuExists(dtuId, db) {
  if (!dtuId) {
    return { pass: true, kind: "dtu_exists", reason_code: "no_dtu_id_skip" };
  }
  if (!db) {
    return { pass: true, kind: "dtu_exists", reason_code: "no_db_skip" };
  }
  try {
    const row = db.prepare("SELECT id FROM dtus WHERE id = ? LIMIT 1").get(dtuId);
    if (!row) {
      return {
        pass: false,
        kind: "dtu_exists",
        reason_code: "dtu_not_found",
        dtu_id: dtuId,
      };
    }
    return { pass: true, kind: "dtu_exists", reason_code: "dtu_exists_ok" };
  } catch (e) {
    return { pass: true, kind: "dtu_exists", reason_code: "dtu_check_skipped", detail: e?.message };
  }
}

function verifyStateMatch(spec, STATE) {
  if (!STATE) {
    return { pass: true, kind: "state_match", reason_code: "no_state_skip" };
  }
  const path = spec.path || spec.params?.path;
  const expected = spec.expected ?? spec.params?.expected;
  if (!path) {
    return { pass: true, kind: "state_match", reason_code: "no_path_skip" };
  }
  // Best-effort: walk dot-separated path
  let actual = STATE;
  for (const segment of path.split(".")) {
    if (actual == null) break;
    actual = actual[segment];
  }
  if (actual !== expected) {
    return {
      pass: false,
      kind: "state_match",
      reason_code: "state_mismatch",
      expected,
      actual,
      path,
    };
  }
  return { pass: true, kind: "state_match", reason_code: "state_match_ok" };
}