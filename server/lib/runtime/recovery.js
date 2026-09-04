// server/lib/runtime/recovery.js
//
// Recovery metrics — detect, diagnose, recover, learn. Tier 1: actually retries missions.

import { pickWorkerForTask, updateWorkerAffect } from "./agent-org.js";
import { failureSignature } from "./execution-ledger.js";
import { routeModel } from "./model-router.js";
import { getConfig } from "./runtime-config.js";

function configNumber(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "object" && raw.value != null) {
    const n = Number(raw.value);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function getMaxRecoveryAttempts(db) {
  const fromConfig = configNumber(getConfig(db, "recovery.max_attempts"));
  if (fromConfig != null && fromConfig >= 0) return fromConfig;

  const raw = process.env.CONCORD_MISSION_RECOVERY_MAX;
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 3;
}

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_recovery_events'`).get();
  } catch {
    return false;
  }
}

function failureTableReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_failure_signatures'`).get();
  } catch {
    return false;
  }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function recordRecoveryEvent(db, event) {
  if (!db || !tablesReady(db) || !event?.missionId) return { ok: false, reason: "missing_inputs" };
  try {
    db.prepare(`
      INSERT INTO runtime_recovery_events
        (mission_id, failure_kind, detection_latency_ms, diagnosis_json,
         recovery_action, recovery_success, resume_latency_ms, learned_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.missionId,
      event.failureKind || "unknown",
      event.detectionLatencyMs ?? null,
      event.diagnosis ? JSON.stringify(event.diagnosis) : null,
      event.recoveryAction || null,
      event.recoverySuccess ? 1 : 0,
      event.resumeLatencyMs ?? null,
      event.learned ? JSON.stringify(event.learned) : null,
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function diagnoseFailure({ tool, gateResult, mission } = {}) {
  const reason = gateResult?.result?.reason || gateResult?.reason || mission?.error_reason || "unknown";
  const diagnosis = { tool, reason, step: mission?.current_step };
  if (/timeout/i.test(String(reason))) diagnosis.kind = "timeout";
  else if (/denied|forbidden|not_allowed/i.test(String(reason))) diagnosis.kind = "authorization";
  else if (/migration|no_db|unavailable/i.test(String(reason))) diagnosis.kind = "infrastructure";
  else diagnosis.kind = "execution";
  return diagnosis;
}

function recordFailureSignature(db, { tool, reason, workerId, repair } = {}) {
  if (!db || !failureTableReady(db)) return;
  const sig = failureSignature({ tool, reason, workerId });
  try {
    db.prepare(`
      INSERT INTO runtime_failure_signatures
        (signature_hash, failure_kind, tool_name, worker_id, repair_json, failure_count, last_seen_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(signature_hash) DO UPDATE SET
        failure_count = failure_count + 1,
        last_seen_at = excluded.last_seen_at,
        repair_json = COALESCE(excluded.repair_json, repair_json)
    `).run(sig, reason || "unknown", tool || null, workerId || null, repair ? JSON.stringify(repair) : null, nowSec());
  } catch { /* optional */ }
}

function lookupPriorRepair(db, { tool, reason, workerId } = {}) {
  if (!db || !failureTableReady(db)) return null;
  const sig = failureSignature({ tool, reason, workerId });
  try {
    const row = db.prepare(`
      SELECT repair_json, success_count FROM runtime_failure_signatures WHERE signature_hash = ?
    `).get(sig);
    if (!row?.repair_json) return null;
    return { ...JSON.parse(row.repair_json), priorSuccesses: row.success_count };
  } catch {
    return null;
  }
}

function pickAlternateWorker(db, { mission, failedWorker } = {}) {
  const director = /research|proactive|initiative/.test(mission?.template || "") ? "research" : "engineering";
  const specs = [
    /coding|repo|code/.test(mission?.goal || "") ? "coding" : null,
    "coding",
    "general",
    null,
  ].filter((s, i, a) => a.indexOf(s) === i);

  for (const specialization of specs) {
    const worker = pickWorkerForTask(db, {
      director,
      specialization: specialization || undefined,
      excludeWorkerId: failedWorker,
      taskUrgency: 0.85,
      minReliability: 0.3,
    });
    if (worker) return worker;
  }
  return pickWorkerForTask(db, { excludeWorkerId: failedWorker, taskUrgency: 0.85 });
}

/**
 * Escalation ladder:
 * 0 → retry_same
 * 1 → reassign_worker
 * 2 → escalate_model
 * 3+ → operator_escalation (terminal)
 */

export async function planRecoveryAction({
  db, mission, diagnosis, failedWorker, attempt,
} = {}) {
  const step = attempt ?? mission?.recovery_attempts ?? 0;

  if (diagnosis?.kind === "timeout" && step === 0) {
    const reassignedWorker = pickAlternateWorker(db, { mission, failedWorker });
    if (reassignedWorker) {
      if (failedWorker) {
        updateWorkerAffect(db, failedWorker, { frustration: 0.1, confidence: -0.05 });
        updateWorkerAffect(db, reassignedWorker, { attention: 0.1, urgency: 0.1 });
      }
      return { recoveryAction: "reassign_worker", recoverySuccess: true, reassignedWorker };
    }
  }

  if (step === 0) {
    return { recoveryAction: "retry_same", recoverySuccess: true, reassignedWorker: failedWorker };
  }
  if (step === 1) {
    const reassignedWorker = pickAlternateWorker(db, { mission, failedWorker });
    if (reassignedWorker) {
      if (failedWorker) {
        updateWorkerAffect(db, failedWorker, { frustration: 0.1, confidence: -0.05 });
        updateWorkerAffect(db, reassignedWorker, { attention: 0.1, urgency: 0.1 });
      }
      return { recoveryAction: "reassign_worker", recoverySuccess: true, reassignedWorker };
    }
    return { recoveryAction: "reassign_worker", recoverySuccess: false, reassignedWorker: null };
  }
  if (step === 2) {
    const route = await routeModel({
      db,
      taskClass: "reasoning",
      goal: mission?.goal,
      hint: "recovery_escalation",
      missionId: mission?.id,
      traceId: mission?.trace_id,
    });
    return {
      recoveryAction: "escalate_model",
      recoverySuccess: true,
      reassignedWorker: route?.workerId || failedWorker,
      escalatedRoute: route,
    };
  }
  return { recoveryAction: "operator_escalation", recoverySuccess: false, reassignedWorker: null };
}

/**
 * Apply recovery to mission row — resets to running for retry when ladder permits.
 */
export function applyMissionRecovery(db, missionId, {
  reassignedWorker, recoveryAction, tickIntervalS = 15,
} = {}) {
  if (!db || !missionId) return { ok: false, reason: "missing_inputs" };
  try {
    const cols = db.prepare(`PRAGMA table_info(mission_tasks)`).all().map((c) => c.name);
    const hasRecovery = cols.includes("recovery_attempts");
    if (!hasRecovery) return { ok: false, reason: "migration_required" };

    db.prepare(`
      UPDATE mission_tasks
      SET status = 'running',
          recovery_attempts = recovery_attempts + 1,
          assigned_worker_id = COALESCE(?, assigned_worker_id),
          error_reason = NULL,
          completed_at = NULL,
          updated_at = ?,
          next_tick_at = ?
      WHERE id = ?
    `).run(reassignedWorker || null, nowSec(), nowSec() + tickIntervalS, missionId);

    return { ok: true, status: "running", recoveryAction };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export async function attemptRecovery({
  db, mission, failure, dispatchMCP, loadCheckpoint, tickIntervalS,
} = {}) {
  if (process.env.CONCORD_MISSION_RECOVERY === "0") {
    return { ok: false, reason: "disabled", shouldRetry: false };
  }

  const started = Date.now();
  const diagnosis = diagnoseFailure(failure);
  const failedWorker = failure?.workerId || mission?.assigned_worker_id;
  const attempt = mission?.recovery_attempts ?? 0;

  if (attempt >= getMaxRecoveryAttempts(db)) {
    const event = {
      missionId: mission.id,
      failureKind: diagnosis.kind,
      detectionLatencyMs: Date.now() - started,
      diagnosis,
      recoveryAction: "exhausted",
      recoverySuccess: false,
      learned: { note: "recovery ladder exhausted" },
    };
    recordRecoveryEvent(db, event);
    return { ok: true, ...event, shouldRetry: false, exhausted: true };
  }

  const priorRepair = lookupPriorRepair(db, {
    tool: failure?.tool,
    reason: diagnosis.reason,
    workerId: failedWorker,
  });

  let plan;
  if (priorRepair?.recoveryAction && (priorRepair.priorSuccesses || 0) > 0) {
    plan = {
      recoveryAction: `prior_repair:${priorRepair.recoveryAction}`,
      recoverySuccess: true,
      reassignedWorker: priorRepair.reassignedWorker || failedWorker,
    };
  } else {
    plan = await planRecoveryAction({ db, mission, diagnosis, failedWorker, attempt });
  }

  if (diagnosis.kind === "authorization") {
    plan = { recoveryAction: "escalate_operator", recoverySuccess: false, reassignedWorker: null };
  } else if (diagnosis.kind === "infrastructure" && loadCheckpoint) {
    const cp = loadCheckpoint(db, mission.id);
    if (cp?.state) {
      plan = {
        recoveryAction: "checkpoint_resume",
        recoverySuccess: true,
        reassignedWorker: failedWorker,
        learned: { resumedFrom: cp.loop_phase },
      };
    }
  }

  const shouldRetry = plan.recoverySuccess && plan.recoveryAction !== "operator_escalation";
  let applied = { ok: false };
  if (shouldRetry) {
    applied = applyMissionRecovery(db, mission.id, {
      reassignedWorker: plan.reassignedWorker,
      recoveryAction: plan.recoveryAction,
      tickIntervalS,
    });
  }

  const detectionLatencyMs = Date.now() - started;
  const learned = {
    note: shouldRetry ? `retry scheduled: ${plan.recoveryAction}` : "recovery could not retry",
    workerId: plan.reassignedWorker,
    attempt: attempt + 1,
  };
  const event = {
    missionId: mission.id,
    failureKind: diagnosis.kind,
    detectionLatencyMs,
    diagnosis,
    recoveryAction: plan.recoveryAction,
    recoverySuccess: plan.recoverySuccess,
    resumeLatencyMs: shouldRetry && applied.ok ? Date.now() - started : null,
    learned,
  };
  recordRecoveryEvent(db, event);

  if (shouldRetry && applied.ok) {
    recordFailureSignature(db, {
      tool: failure?.tool,
      reason: diagnosis.reason,
      workerId: plan.reassignedWorker,
      repair: { recoveryAction: plan.recoveryAction, reassignedWorker: plan.reassignedWorker },
    });
  }

  return {
    ok: true,
    ...event,
    reassignedWorker: plan.reassignedWorker,
    shouldRetry: shouldRetry && applied.ok,
    applied: applied.ok,
    escalatedRoute: plan.escalatedRoute || null,
  };
}

export function recoveryOverview(db, limit = 20) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  try {
    const rows = db.prepare(`
      SELECT mission_id, failure_kind, recovery_action, recovery_success,
             detection_latency_ms, resume_latency_ms, created_at
      FROM runtime_recovery_events
      ORDER BY created_at DESC LIMIT ?
    `).all(Math.min(limit, 100));
    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        AVG(recovery_success) AS success_rate,
        AVG(detection_latency_ms) AS avg_detection_ms,
        AVG(resume_latency_ms) AS avg_resume_ms
      FROM runtime_recovery_events
    `).get();
    return { ok: true, recent: rows, stats, maxAttempts: getMaxRecoveryAttempts(db) };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}
