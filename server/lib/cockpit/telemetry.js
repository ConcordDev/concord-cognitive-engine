// Failure telemetry on top of agent_action_log (no new table).
import { classifyFailure } from "./failure-taxonomy.js";
import { cockpitFlag } from "./flags.js";
import { recordAction } from "../agent-action-log.js";

/**
 * Record one tool outcome in agent_action_log. Never throws, never awaits the caller.
 * @param {object} db
 * @param {{ userId: string, sessionId?: string|null, surface: string, call: {tool:string, params?:object}, result: object }} e
 */
export function recordToolOutcomeEvent(db, e) {
  try {
    if (!cockpitFlag("TELEMETRY") || !db || !e?.userId || !e.call || !e.result) return;
    const p = recordAction(db, {
      userId: e.userId,
      sessionId: e.sessionId || null,
      action: `tool:${e.call.tool}`,
      input: e.call.params ?? null,
      output: e.result.result ?? e.result.error ?? null,
      tool: e.call.tool,
      outcome: e.result.ok ? `ok|${e.surface}` : `error:${classifyFailure(e.result).class}|${e.surface}`,
    });
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch { /* telemetry never blocks a turn */ }
}

/**
 * @param {object} db
 * @param {{ userId?: string|null, sinceSec: number }} q   userId null means all users
 */
export function failureCounts(db, q) {
  try {
    const params = [q.sinceSec];
    let sql = "SELECT tool, outcome FROM agent_action_log WHERE created_at >= ?";
    if (q.userId) { sql += " AND user_id = ?"; params.push(q.userId); }
    sql += " LIMIT 50000";
    const rows = db.prepare(sql).all(...params);
    const byClass = {};
    const byTool = {};
    let failed = 0;
    for (const row of rows) {
      const outcome = String(row.outcome || "");
      const tool = row.tool || "unknown";
      const t = (byTool[tool] ||= { calls: 0, failed: 0 });
      t.calls += 1;
      if (outcome === "ok" || outcome.startsWith("ok|")) continue;
      failed += 1;
      t.failed += 1;
      const m = /^error:([a-z_]+)/.exec(outcome);
      const cls = m ? m[1] : "unclassified";
      byClass[cls] = (byClass[cls] || 0) + 1;
    }
    return { ok: true, total: rows.length, failed, byClass, byTool };
  } catch {
    return { ok: false, reason: "no_table" };
  }
}
