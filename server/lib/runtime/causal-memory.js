// server/lib/runtime/causal-memory.js
//
// Causal memory graph — EVENT → ACTION → RESULT → CAUSE → CONSEQUENCE → LESSON

import crypto from "node:crypto";
import { recordNode, linkNodes } from "./memory-graph.js";

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_causal_chains'`).get();
  } catch {
    return false;
  }
}

function chainSignature({ event, action, cause } = {}) {
  const raw = `${event?.kind || ""}|${action?.tool || action?.kind || ""}|${cause?.kind || ""}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

export function recordCausalChain(db, {
  missionId, event, action, result, cause, consequence, lesson,
} = {}) {
  if (!db || !tablesReady(db) || !event || !action || !result) {
    return { ok: false, reason: "missing_inputs" };
  }
  const sig = chainSignature({ event, action, cause });
  try {
    const ins = db.prepare(`
      INSERT INTO runtime_causal_chains
        (mission_id, event_json, action_json, result_json, cause_json, consequence_json, lesson, signature_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      missionId || null,
      JSON.stringify(event),
      JSON.stringify(action),
      JSON.stringify(result),
      cause ? JSON.stringify(cause) : null,
      consequence ? JSON.stringify(consequence) : null,
      lesson || null,
      sig,
    );

    const mem = recordNode(db, {
      memoryClass: result.ok === false ? "episodic" : "durable",
      kind: "causal_lesson",
      refId: missionId || sig,
      title: lesson?.slice(0, 120) || `Causal: ${event.kind || "event"}`,
      content: { event, action, result, cause, consequence, lesson, signature: sig },
      provenance: { mission_id: missionId, causal_chain_id: ins.lastInsertRowid },
    });

    return { ok: true, chainId: ins.lastInsertRowid, signature: sig, memoryNodeId: mem.nodeId };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function retrieveRelevantLessons(db, { tool, failureKind, goal, limit = 5 } = {}) {
  if (!db || !tablesReady(db)) return [];
  const cap = Math.min(Math.max(limit, 1), 20);
  try {
    const clauses = [];
    const params = [];
    if (tool) {
      clauses.push(`action_json LIKE ?`);
      params.push(`%${tool}%`);
    }
    if (failureKind) {
      clauses.push(`(cause_json LIKE ? OR result_json LIKE ?)`);
      params.push(`%${failureKind}%`, `%${failureKind}%`);
    }
    if (goal) {
      clauses.push(`lesson LIKE ?`);
      params.push(`%${String(goal).slice(0, 40)}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return db.prepare(`
      SELECT id, mission_id, lesson, signature_hash, event_json, action_json, result_json, cause_json, created_at
      FROM runtime_causal_chains ${where}
      ORDER BY created_at DESC LIMIT ?
    `).all(...params, cap).map((row) => ({
      ...row,
      event: row.event_json ? JSON.parse(row.event_json) : null,
      action: row.action_json ? JSON.parse(row.action_json) : null,
      result: row.result_json ? JSON.parse(row.result_json) : null,
      cause: row.cause_json ? JSON.parse(row.cause_json) : null,
    }));
  } catch {
    return [];
  }
}

export function recordMissionStepCausal(db, {
  mission, step, gateResult, executionOutcome, critic, recovery,
} = {}) {
  const ok = executionOutcome === "SUCCESS" || executionOutcome === "PARTIAL";
  const lesson = ok
    ? `Step ${step?.tool} succeeded for mission ${mission?.template || mission?.id}`
    : recovery?.recoveryAction
      ? `On ${step?.tool} failure (${executionOutcome}), applied ${recovery.recoveryAction}`
      : `Step ${step?.tool} failed (${executionOutcome}) — ${critic?.recommendation || "investigate"}`;

  return recordCausalChain(db, {
    missionId: mission?.id,
    event: { kind: "mission_step", tool: step?.tool, stepIndex: mission?.current_step },
    action: { tool: step?.tool, args: step?.args, worker: mission?.assigned_worker_id },
    result: { ok, outcome: executionOutcome, summary: gateResult?.result },
    cause: recovery?.diagnosis || (ok ? { kind: "success" } : { kind: executionOutcome }),
    consequence: { critic: critic?.verdict, progression: critic?.progression },
    lesson,
  });
}

export function causalMemoryOverview(db) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  try {
    const total = db.prepare(`SELECT COUNT(*) AS c FROM runtime_causal_chains`).get()?.c || 0;
    const withLesson = db.prepare(`SELECT COUNT(*) AS c FROM runtime_causal_chains WHERE lesson IS NOT NULL`).get()?.c || 0;
    return { ok: true, total, withLesson };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}
