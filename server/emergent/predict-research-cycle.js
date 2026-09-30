// server/emergent/predict-research-cycle.js
//
// Concord Predict P7 — the autonomous OBSERVE -> ... -> PROMOTE OR REJECT
// loop from docs/CONCORD_RUNTIME_MASTER_SPEC.md §15/§16, scoped honestly to
// what this heartbeat can actually and safely do:
//
//   OBSERVE (every model_id with resolved live tickets)
//     -> compute evidenceStage via predict.authorityStatus (real evidence:
//        live-trade reconciliation + calibration, generic default
//        thresholds — no model-specific benchmark/stop-rule is baked in
//        here, keeping this domain-agnostic)
//     -> on a STAGE TRANSITION, record a durable DTU finding (SYNTHESIZE)
//
// It stops there. "PROMOTE" is explicitly and permanently out of this
// heartbeat's reach: predict.authorityStatus can only ever recommend up to
// VALIDATED; the ONLY path to PROMOTED is predict.promoteAuthority, which
// requires an explicit human operatorId + confirm:true. This loop calling
// promoteAuthority on its own would be exactly the failure mode
// docs/CONCORD_RUNTIME_MASTER_SPEC.md §14/§16 warns against — "no agent
// should simply create a new capability and immediately gain production
// authority" — so it never does, structurally, not just by convention.
//
// Domain-specific stop-rule checks (which need a real backtest benchmark
// table Concord Predict has no business hardcoding) stay in the operator-
// run Python-side report (dila-tools/trading/predict_reconcile_report.py)
// — this heartbeat's job is the always-on, zero-config baseline that
// requires no external input.
import logger from "../logger.js";

let _STATE_REF = null;

/** Called once from server.js after STATE is constructed. */
export function initPredictResearchCycle(STATE) {
  _STATE_REF = STATE;
}

export async function runPredictResearchCycle() {
  if (!_STATE_REF) return { ok: false, reason: "state_not_initialised" };
  const db = _STATE_REF.db;
  if (!db) return { ok: false, reason: "no_db" };

  const handler = globalThis.__concordLensActions?.get("predict.authorityStatus");
  if (typeof handler !== "function") return { ok: false, reason: "authority_status_not_registered" };

  let modelIds;
  try {
    modelIds = db.prepare("SELECT DISTINCT model_id FROM prediction_tickets").all().map((r) => r.model_id).filter(Boolean);
  } catch (err) {
    return { ok: false, reason: "query_failed", error: err?.message };
  }

  // Trusted server-side heartbeat: role/internal mark it as such for the
  // operator-only predict domain (lib/runtime/operator-gate.js).
  const ctx = { db, actor: { userId: "system", role: "system", internal: true } };
  const results = [];
  for (const modelId of modelIds) {
    try {
      const artifact = { id: null, domain: "predict", type: "domain_action", data: { modelId }, meta: {} };
      const res = await handler(ctx, artifact, { modelId });
      const r = res?.result;
      if (r) {
        results.push({ modelId, stage: r.stage, evidenceStage: r.evidenceStage, n: r.n, transitioned: !!r.transitioned, dtuId: r.dtuId || null });
        if (r.transitioned) {
          try { logger.info("predict-research-cycle", "authority_transition", { modelId, from: r.reasons?.[0], to: r.stage, n: r.n }); } catch { /* logging must never break the tick */ }
        }
      } else {
        results.push({ modelId, ok: false, reason: res?.reason || res?.error || "unknown" });
      }
    } catch (err) {
      // One model's failure must never stop the pass over the rest.
      results.push({ modelId, ok: false, error: err?.message || String(err) });
    }
  }

  return { ok: true, checked: results.length, results };
}
