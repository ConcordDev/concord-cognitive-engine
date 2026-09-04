// server/lib/runtime/agent-org.js
//
// Persistent computational organization — directors, workers, reliability + affect.

import { DIRECTORS } from "./constants.js";

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_org_workers'`).get();
  } catch {
    return false;
  }
}

function directorForWorker(name) {
  const n = String(name || "");
  if (/research|kimi|gemini|data|embed|summary|distill/.test(n)) return "research";
  if (/code|mistral|grok|frontend|qa|pickle|lightning|vision/.test(n)) return "engineering";
  return "operations";
}

function specializationFor(name) {
  const n = String(name || "");
  if (/code|grok-code|mistral/.test(n)) return "coding";
  if (/research|kimi|gemini|data/.test(n)) return "research";
  if (/qa|test/.test(n)) return "qa";
  if (/ops|lightning/.test(n)) return "operations";
  if (/vision|embed/.test(n)) return "vision";
  return "general";
}

function parseAffect(affectJson) {
  try {
    const a = typeof affectJson === "string" ? JSON.parse(affectJson) : (affectJson || {});
    return {
      confidence: Number(a.confidence ?? 0.5),
      urgency: Number(a.urgency ?? 0.5),
      frustration: Number(a.frustration ?? 0.1),
      attention: Number(a.attention ?? 0.7),
      riskSensitivity: Number(a.risk_sensitivity ?? a.riskSensitivity ?? 0.5),
    };
  } catch {
    return { confidence: 0.5, urgency: 0.5, frustration: 0.1, attention: 0.7, riskSensitivity: 0.5 };
  }
}

/**
 * Composite worker score — reliability + affect (lower frustration wins).
 */
export function scoreWorker(row, { taskUrgency = 0.5 } = {}) {
  if (!row) return 0;
  const affect = parseAffect(row.affect_json);
  const reliability = Number(row.reliability_score ?? 0.5);
  const frustrationPenalty = affect.frustration * 0.35;
  const confidenceBoost = affect.confidence * 0.2;
  const attentionBoost = affect.attention * 0.1;
  const urgencyMatch = taskUrgency > 0.6 ? affect.urgency * 0.1 : 0;
  return reliability + confidenceBoost + attentionBoost + urgencyMatch - frustrationPenalty;
}

export function listWorkersForTask(db, {
  director, specialization, minReliability = 0.3, excludeWorkerId, taskUrgency = 0.5,
} = {}) {
  if (!db || !tablesReady(db)) return [];
  try {
    let rows;
    if (director && specialization) {
      rows = db.prepare(`
        SELECT * FROM runtime_org_workers
        WHERE director = ? AND specialization = ? AND reliability_score >= ?
      `).all(director, specialization, minReliability);
    } else if (director) {
      rows = db.prepare(`
        SELECT * FROM runtime_org_workers
        WHERE director = ? AND reliability_score >= ?
      `).all(director, minReliability);
    } else {
      rows = db.prepare(`
        SELECT * FROM runtime_org_workers WHERE reliability_score >= ?
      `).all(minReliability);
    }
    return rows
      .filter((r) => r.worker_id !== excludeWorkerId)
      .map((r) => ({ ...r, score: scoreWorker(r, { taskUrgency }) }))
      .sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}

export function updateWorkerAffect(db, workerId, delta = {}) {
  if (!db || !tablesReady(db) || !workerId) return { ok: false, reason: "missing_inputs" };
  try {
    const row = db.prepare(`SELECT affect_json FROM runtime_org_workers WHERE worker_id = ?`).get(workerId);
    const affect = parseAffect(row?.affect_json);
    const next = {
      confidence: Math.max(0, Math.min(1, affect.confidence + (delta.confidence || 0))),
      urgency: Math.max(0, Math.min(1, affect.urgency + (delta.urgency || 0))),
      frustration: Math.max(0, Math.min(1, affect.frustration + (delta.frustration || 0))),
      attention: Math.max(0, Math.min(1, affect.attention + (delta.attention || 0))),
    };
    db.prepare(`UPDATE runtime_org_workers SET affect_json = ?, updated_at = ? WHERE worker_id = ?`)
      .run(JSON.stringify(next), Math.floor(Date.now() / 1000), workerId);
    return { ok: true, affect: next };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export async function syncOrgFromRoster(db) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  let roster = [];
  try {
    const { getWorkerRoster } = await import("../dila-workers.js");
    roster = await getWorkerRoster();
  } catch {
    return { ok: false, reason: "roster_unavailable" };
  }

  const now = Math.floor(Date.now() / 1000);
  const ins = db.prepare(`
    INSERT INTO runtime_org_workers
      (worker_id, director, specialization, reliability_score, affect_json, updated_at)
    VALUES (?, ?, ?, 0.5, ?, ?)
    ON CONFLICT(worker_id) DO UPDATE SET
      director = excluded.director,
      specialization = excluded.specialization,
      updated_at = excluded.updated_at
  `);

  for (const w of roster) {
    const director = directorForWorker(w.name);
    const specialization = specializationFor(w.name);
    const affect = JSON.stringify({
      confidence: w.alive ? 0.7 : 0.3,
      urgency: 0.5,
      frustration: w.alive ? 0.1 : 0.5,
      attention: w.alive ? 0.8 : 0.2,
    });
    ins.run(w.name, director, specialization, affect, now);
  }
  return { ok: true, synced: roster.length };
}

export function recordWorkerOutcome(db, workerId, { success, cost = 0, missionId } = {}) {
  if (!db || !tablesReady(db) || !workerId) return { ok: false, reason: "missing_inputs" };
  const now = Math.floor(Date.now() / 1000);
  try {
    const row = db.prepare(`SELECT * FROM runtime_org_workers WHERE worker_id = ?`).get(workerId);
    if (!row) {
      db.prepare(`
        INSERT INTO runtime_org_workers (worker_id, director, specialization, updated_at)
        VALUES (?, 'operations', 'general', ?)
      `).run(workerId, now);
    }
    const completed = (row?.tasks_completed || 0) + (success ? 1 : 0);
    const failed = (row?.tasks_failed || 0) + (success ? 0 : 1);
    const total = completed + failed;
    const reliability = total > 0 ? completed / total : 0.5;
    db.prepare(`
      UPDATE runtime_org_workers
      SET tasks_completed = ?, tasks_failed = ?, reliability_score = ?,
          cost_total = cost_total + ?, current_mission_id = ?, updated_at = ?
      WHERE worker_id = ?
    `).run(completed, failed, reliability, cost, missionId || null, now, workerId);
    updateWorkerAffect(db, workerId, {
      confidence: success ? 0.05 : -0.1,
      frustration: success ? -0.05 : 0.15,
      attention: success ? 0.02 : -0.05,
    });
    return { ok: true, reliability };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function pickWorkerForTask(db, {
  director, specialization, minReliability = 0.4, excludeWorkerId, taskUrgency = 0.5,
} = {}) {
  const ranked = listWorkersForTask(db, {
    director, specialization, minReliability, excludeWorkerId, taskUrgency,
  });
  return ranked[0]?.worker_id || null;
}

export function orgOverview(db) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  try {
    const byDirector = {};
    for (const d of DIRECTORS) {
      const rows = db.prepare(`
        SELECT worker_id, specialization, reliability_score, tasks_completed, tasks_failed,
               current_mission_id, affect_json
        FROM runtime_org_workers WHERE director = ?
        ORDER BY reliability_score DESC
      `).all(d);
      byDirector[d] = rows.map((r) => ({
        ...r,
        score: scoreWorker(r),
        affect: parseAffect(r.affect_json),
      }));
    }
    return { ok: true, directors: byDirector };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}
