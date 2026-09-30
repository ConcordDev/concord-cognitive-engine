// server/lib/auth-gate/evaluate.js
//
// F0.3 — AuthGate.evaluate(): the orchestrator.
//
// Calls existing authority systems in canonical order. Does NOT define policy.
// Returns one of: ALLOW | DENY | DEFER | OBSERVE | ESCALATE.
//
// Architecture (honest count — gates/ has 10 modules; evaluate runs 10 checks):
//   1. Sovereignty hard veto (IMMUTABLE — hard veto, no override)
//   2. Capability existence + health (POLICY)
//   3. Risk tier — high → ESCALATE (inline from capability result; no separate risk.js)
//   4. Refusal field (CONSTITUTIONAL)
//   5. Provenance action-time (CONSTITUTIONAL)
//   6. Expiration TTL
//   7. Preconditions
//   8. Idempotency
//   9. Resource / budget
//  10. Rollback spec for mutations
// Post-tool verification lives in dispatch.js (gates/verification.js) — not in evaluate().
// Do not call this an "eight-gate" composition; that label is stale.

import { applyDecision } from "./envelope.js";
import * as sovereigntyGate from "./gates/sovereignty.js";
import * as capabilityGate from "./gates/capability.js";
import * as refusalGate from "./gates/refusal.js";
import * as provenanceGate from "./gates/provenance.js";
import * as expirationGate from "./gates/expiration.js";
import * as preconditionsGate from "./gates/preconditions.js";
import * as idempotencyGate from "./gates/idempotency.js";
import * as resourceGate from "./gates/resource.js";
import * as rollbackGate from "./gates/rollback.js";

/** FROZEN — the 5 decision outcomes. */
export const DECISION = Object.freeze({
  ALLOW: "ALLOW",
  DENY: "DENY",
  DEFER: "DEFER",
  OBSERVE: "OBSERVE",
  ESCALATE: "ESCALATE",
});

/**
 * Evaluate an envelope through all gates in canonical order.
 *
 * @param {Object} envelope       — Built by buildEnvelope()
 * @param {Object} [ctx]          — Optional context
 * @param {Object} [ctx.db]       — Database handle
 * @param {Object} [ctx.STATE]    — Concord STATE
 * @param {boolean} [ctx.observe_only] — If true, log decisions but don't deny
 * @returns {Object} {envelope, decision, decision_id, gates_run}
 */
export async function evaluate(envelope, ctx = {}) {
  if (!envelope || !envelope.WHAT) {
    return {
      envelope,
      decision: DECISION.DENY,
      decision_id: null,
      reason_code: "invalid_envelope",
      gates_run: [],
    };
  }

  const gates_run = [];
  const observeOnly = ctx.observe_only === true;

  const record = (name, result, decision) => {
    gates_run.push({ name, result, decision });
  };

  // 1. Sovereignty hard veto (IMMUTABLE tier)
  try {
    const result = await sovereigntyGate.check(envelope);
    if (!result.pass) {
      record("sovereignty", result, DECISION.DENY);
      return finalize(envelope, DECISION.DENY, result.reason_code || "sovereignty_hard_veto", gates_run, observeOnly);
    }
    record("sovereignty", result, DECISION.ALLOW);
  } catch (e) {
    record("sovereignty", { error: e?.message }, DECISION.DENY);
    return finalize(envelope, DECISION.DENY, "sovereignty_gate_error", gates_run, observeOnly);
  }

  // 2. Capability existence + health
  let capResult = null;
  try {
    capResult = await capabilityGate.check(envelope);
    if (!capResult.ok) {
      record("capability", capResult, DECISION.DENY);
      return finalize(envelope, DECISION.DENY, capResult.reason_code || "capability_failed", gates_run, observeOnly);
    }
    record("capability", capResult, DECISION.ALLOW);
  } catch (e) {
    record("capability", { error: e?.message }, DECISION.DENY);
    return finalize(envelope, DECISION.DENY, "capability_gate_error", gates_run, observeOnly);
  }

  // 3. Risk classification — high → ESCALATE
  if (capResult.risk === "high") {
    record("risk", { risk: "high" }, DECISION.ESCALATE);
    return finalize(envelope, DECISION.ESCALATE, "high_risk_escalation", gates_run, observeOnly);
  }

  // 4. Refusal field
  try {
    const result = await refusalGate.check(envelope, ctx.db);
    if (!result.pass) {
      record("refusal", result, DECISION.DENY);
      return finalize(envelope, DECISION.DENY, result.reason_code || "refused", gates_run, observeOnly);
    }
    record("refusal", result, DECISION.ALLOW);
  } catch (e) {
    record("refusal", { error: e?.message }, DECISION.ALLOW); // refusal errors don't block
  }

  // 5. Provenance action-time
  try {
    const result = await provenanceGate.check(envelope);
    if (!result.pass) {
      record("provenance", result, DECISION.DENY);
      return finalize(envelope, DECISION.DENY, result.reason_code || "provenance_rejected", gates_run, observeOnly);
    }
    record("provenance", result, DECISION.ALLOW);
  } catch (e) {
    record("provenance", { error: e?.message }, DECISION.ALLOW); // provenance errors don't block
  }

  // 6. Expiration TTL
  try {
    const result = await expirationGate.check(envelope);
    if (!result.pass) {
      record("expiration", result, DECISION.DENY);
      return finalize(envelope, DECISION.DENY, result.reason_code || "expired", gates_run, observeOnly);
    }
    record("expiration", result, DECISION.ALLOW);
  } catch (e) {
    record("expiration", { error: e?.message }, DECISION.DENY);
    return finalize(envelope, DECISION.DENY, "expiration_check_error", gates_run, observeOnly);
  }

  // 7. Preconditions
  try {
    const result = await preconditionsGate.check(envelope, ctx.STATE);
    if (!result.pass) {
      record("preconditions", result, DECISION.DEFER);
      return finalize(envelope, DECISION.DEFER, result.reason_code || "preconditions_not_met", gates_run, observeOnly);
    }
    record("preconditions", result, DECISION.ALLOW);
  } catch (e) {
    record("preconditions", { error: e?.message }, DECISION.DEFER); // preconditions error → DEFER (not deny)
    return finalize(envelope, DECISION.DEFER, "preconditions_check_error", gates_run, observeOnly);
  }

  // 8. Idempotency
  try {
    const result = await idempotencyGate.check(envelope);
    if (!result.pass) {
      record("idempotency", result, DECISION.DENY);
      return finalize(envelope, DECISION.DENY, result.reason_code || "replay_detected", gates_run, observeOnly);
    }
    // If cached result exists (true idempotent replay), short-circuit
    if (result.cached && result.result !== undefined) {
      record("idempotency", result, DECISION.ALLOW);
      return {
        envelope,
        decision: DECISION.ALLOW,
        decision_id: null,
        reason_code: "idempotent_replay_cached",
        gates_run,
        cached_result: result.result,
      };
    }
    record("idempotency", result, DECISION.ALLOW);
  } catch (e) {
    record("idempotency", { error: e?.message }, DECISION.ALLOW); // idempotency errors don't block
  }

  // 9. Resource / budget
  try {
    const result = await resourceGate.check(envelope, ctx);
    if (!result.pass) {
      record("resource", result, DECISION.DENY);
      return finalize(envelope, DECISION.DENY, result.reason_code || "budget_exceeded", gates_run, observeOnly);
    }
    record("resource", result, DECISION.ALLOW);
  } catch (e) {
    record("resource", { error: e?.message }, DECISION.ALLOW);
  }

  // 10. Rollback spec for mutations
  try {
    const result = await rollbackGate.check(envelope);
    if (!result.pass) {
      record("rollback", result, DECISION.DENY);
      return finalize(envelope, DECISION.DENY, result.reason_code || "rollback_spec_missing", gates_run, observeOnly);
    }
    record("rollback", result, DECISION.ALLOW);
  } catch (e) {
    record("rollback", { error: e?.message }, DECISION.ALLOW);
  }

  // All gates passed
  record("__all__", { passed: true }, DECISION.ALLOW);
  return finalize(envelope, DECISION.ALLOW, "all_gates_passed", gates_run, observeOnly);
}

function finalize(envelope, decision, reason_code, gates_run, observeOnly) {
  // In observe-only mode, ALLOW/DENY downgrades become OBSERVE
  let finalDecision = decision;
  if (observeOnly && (decision === DECISION.DENY)) {
    finalDecision = DECISION.OBSERVE;
  }

  const finalEnvelope = applyDecision(envelope, {
    decision_type: finalDecision,
    policy_result: reason_code,
    reason_code,
    decided_by: "system",
  });

  return {
    envelope: finalEnvelope,
    decision: finalDecision,
    decision_id: finalEnvelope.DECISION.decision_id,
    reason_code,
    gates_run,
    was_denied_but_observed: observeOnly && decision === DECISION.DENY,
  };
}