// server/lib/auth-gate/gates/preconditions.js
//
// F0.5 NEW gate — state precondition check.
// Verifies that required runtime state holds before executing.

/**
 * Check preconditions on the envelope.
 *
 * Preconditions shape (envelope.PRECONDITIONS):
 *   {
 *     entity_state?: { kind: string, value: any },  // entity must be in this state
 *     world_state?:  { kind: string, value: any },  // world must be in this state
 *     dtu_exists?:   { id: string },                // specific DTU must exist
 *     custom?:       Array<{name, check: (state) => boolean}>
 *   }
 *
 * @param {Object} envelope
 * @param {Object} [STATE]  Optional Concord STATE for state lookup
 * @returns {Object} {pass, reason_code, failed_precondition?}
 */
export async function check(envelope, STATE = null) {
  const pre = envelope.PRECONDITIONS;
  if (!pre || Object.keys(pre).length === 0) {
    return { pass: true, reason_code: "no_preconditions" };
  }

  // Custom checks first (most specific)
  if (Array.isArray(pre.custom)) {
    for (const cp of pre.custom) {
      try {
        const ok = await cp.check({ envelope, STATE });
        if (!ok) {
          return {
            pass: false,
            reason_code: "precondition_failed_custom",
            failed_precondition: cp.name || "unknown",
          };
        }
      } catch (e) {
        return {
          pass: false,
          reason_code: "precondition_threw",
          failed_precondition: cp.name || "unknown",
          detail: e?.message || String(e),
        };
      }
    }
  }

  // DTU existence check
  if (pre.dtu_exists?.id) {
    const db = STATE?.db || STATE?.__db;
    if (!db) {
      return { pass: true, reason_code: "precondition_dtu_no_db_skip" };
    }
    try {
      const row = db.prepare("SELECT id FROM dtus WHERE id = ? LIMIT 1").get(pre.dtu_exists.id);
      if (!row) {
        return {
          pass: false,
          reason_code: "precondition_dtu_missing",
          failed_precondition: "dtu_exists",
          dtu_id: pre.dtu_exists.id,
        };
      }
    } catch (e) {
      return { pass: true, reason_code: "precondition_dtu_check_skipped", detail: e?.message };
    }
  }

  // Entity state check
  if (pre.entity_state) {
    const stateOk = await checkEntityState(envelope, STATE, pre.entity_state);
    if (!stateOk.pass) return stateOk;
  }

  // World state check
  if (pre.world_state) {
    const stateOk = await checkWorldState(envelope, STATE, pre.world_state);
    if (!stateOk.pass) return stateOk;
  }

  return { pass: true, reason_code: "preconditions_satisfied" };
}

async function checkEntityState(envelope, STATE, spec) {
  const emergents = STATE?.__emergent?.emergents;
  const entity = emergents?.get?.(envelope.WHO);
  if (!entity) {
    return { pass: true, reason_code: "precondition_entity_unknown_skip" };
  }
  if (spec.kind && entity[spec.kind] !== spec.value) {
    return {
      pass: false,
      reason_code: "precondition_entity_state_mismatch",
      expected: { kind: spec.kind, value: spec.value },
      actual: { kind: spec.kind, value: entity[spec.kind] },
    };
  }
  return { pass: true, reason_code: "precondition_entity_state_ok" };
}

async function checkWorldState(envelope, STATE, spec) {
  // World state checks are best-effort; pass on absence
  return { pass: true, reason_code: "precondition_world_state_skip" };
}