// server/lib/browser-agent/audit.js
//
// Append-only per-action audit log + task state machine helpers.
// Every browser action a task takes (click / type / navigate /
// screenshot / extract / wait / approval) lands here so the user can
// replay any session forensically — and so we can show the LiveView
// stream and the cost dashboard.

import { randomUUID } from "node:crypto";
import { costForAction, canSpend, canStartAnother, getBudget } from "./budget.js";
import { requiresApproval, approvalReason } from "./safety.js";

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

// ─── Tasks ────────────────────────────────────────────────────────

export function createTask(db, {
  userId, title, goal, startingUrl = null, approvalMode = null,
  maxSteps = 30, maxCostCents = null, toolAllowlist = null,
  marathonSessionId = null, contextIsolated = true,
  userAgent = null, geoRegion = null, proxyUrl = null,
}) {
  if (!db || !userId || !title || !goal) return { ok: false, reason: "missing_args" };
  const can = canStartAnother(db, userId);
  if (!can.ok) return { ok: false, reason: can.reason, live: can.live, limit: can.limit };
  const budget = getBudget(db, userId);
  const id = `btsk:${randomUUID()}`;
  const mode = ["off","destructive_only","every_step"].includes(approvalMode) ? approvalMode : budget.approval_mode_default;
  try {
    db.prepare(`
      INSERT INTO browser_tasks
        (id, user_id, marathon_session_id, title, goal, starting_url, status,
         approval_mode, max_steps, max_cost_cents, tool_allowlist_json,
         context_isolated, user_agent, geo_region, proxy_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, marathonSessionId,
      String(title).slice(0, 200), String(goal).slice(0, 2000),
      startingUrl ? String(startingUrl).slice(0, 1000) : null,
      mode, Math.max(1, Math.min(500, Number(maxSteps) || 30)),
      maxCostCents != null ? Math.max(1, Number(maxCostCents)) : null,
      toolAllowlist ? JSON.stringify(toolAllowlist) : null,
      contextIsolated ? 1 : 0,
      userAgent, geoRegion, proxyUrl,
      _now(), _now());
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getTask(db, id) {
  if (!db || !id) return null;
  const row = db.prepare(`SELECT * FROM browser_tasks WHERE id = ?`).get(id);
  if (!row) return null;
  return { ...row, tool_allowlist: _safeJson(row.tool_allowlist_json, null) };
}

export function listTasksForUser(db, userId, { status = null, limit = 100 } = {}) {
  if (!db || !userId) return [];
  const sql = status
    ? `SELECT * FROM browser_tasks WHERE user_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?`
    : `SELECT * FROM browser_tasks WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`;
  const args = status ? [userId, status, Math.min(Number(limit) || 100, 500)] : [userId, Math.min(Number(limit) || 100, 500)];
  return db.prepare(sql).all(...args);
}

export function transitionTask(db, id, nextStatus, patch = {}) {
  const valid = ["pending","planning","awaiting_approval","running","paused","completed","failed","cancelled","budget_exceeded"];
  if (!db || !id || !valid.includes(nextStatus)) return { ok: false, reason: "invalid_args" };
  const sets = ["status = ?", "updated_at = ?"];
  const args = [nextStatus, _now()];
  if (patch.startedAt && !patch.started_at) patch.started_at = patch.startedAt;
  if (patch.completedAt && !patch.completed_at) patch.completed_at = patch.completedAt;
  if (patch.started_at != null) { sets.push("started_at = ?"); args.push(patch.started_at); }
  if (patch.completed_at != null) { sets.push("completed_at = ?"); args.push(patch.completed_at); }
  if (patch.result_summary !== undefined) { sets.push("result_summary = ?"); args.push(patch.result_summary ? String(patch.result_summary).slice(0, 4000) : null); }
  args.push(id);
  const r = db.prepare(`UPDATE browser_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  return { ok: r.changes > 0 };
}

// ─── Actions ──────────────────────────────────────────────────────

/**
 * Append a single action to the audit log. Increments task counters.
 * Returns { ok, actionId, stepIndex } — or a budget/safety stop.
 */
export function recordAction(db, taskId, action = {}) {
  if (!db || !taskId) return { ok: false, reason: "missing_args" };
  const task = getTask(db, taskId);
  if (!task) return { ok: false, reason: "not_found" };

  // Step cap
  if ((task.total_steps || 0) >= task.max_steps) {
    transitionTask(db, taskId, "completed", { result_summary: "Step cap reached" });
    return { ok: false, reason: "step_cap_reached" };
  }

  // Cost cap
  const cost = costForAction(action);
  const spend = canSpend(db, task, cost.cents);
  if (!spend.ok) {
    transitionTask(db, taskId, "budget_exceeded", { result_summary: `Budget cap hit: ${spend.reason}` });
    return { ok: false, reason: spend.reason, ...spend };
  }

  // Approval gate
  if (requiresApproval(task, action)) {
    const reason = approvalReason(action) || "destructive_action";
    const insertA = db.prepare(`
      INSERT INTO browser_task_approvals (task_id, step_index, reason, proposed_action_json, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(taskId, task.total_steps, reason, JSON.stringify(action), _now(), _now() + 3600);
    transitionTask(db, taskId, "awaiting_approval");
    return { ok: false, reason: "approval_required", approvalId: insertA.lastInsertRowid, approvalReason: reason };
  }

  // Record the action
  const stepIndex = task.total_steps;
  const ins = db.prepare(`
    INSERT INTO browser_task_actions
      (task_id, step_index, kind, tool, url, selector, value, thought, result_json,
       destructive, success, latency_ms, cost_cents, tokens, screenshot_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(taskId, stepIndex,
    String(action.kind || "llm_step"),
    action.tool ? String(action.tool).slice(0, 60) : null,
    action.url ? String(action.url).slice(0, 1000) : null,
    action.selector ? String(action.selector).slice(0, 500) : null,
    action.value ? String(action.value).slice(0, 2000) : null,
    action.thought ? String(action.thought).slice(0, 2000) : null,
    action.result ? JSON.stringify(action.result).slice(0, 8000) : null,
    action.destructive ? 1 : 0,
    action.success === false ? 0 : 1,
    action.latencyMs != null ? Number(action.latencyMs) : null,
    cost.cents,
    Number(action.tokens) || 0,
    action.screenshotUrl || null,
    _now());

  db.prepare(`
    UPDATE browser_tasks SET
      total_steps = total_steps + 1,
      total_cost_cents = total_cost_cents + ?,
      total_tokens = total_tokens + ?,
      updated_at = ?
    WHERE id = ?
  `).run(cost.cents, Number(action.tokens) || 0, _now(), taskId);

  return { ok: true, actionId: ins.lastInsertRowid, stepIndex, costCents: cost.cents };
}

export function listActions(db, taskId, { limit = 500, since = 0 } = {}) {
  if (!db || !taskId) return [];
  return db.prepare(`
    SELECT * FROM browser_task_actions WHERE task_id = ? AND step_index >= ?
    ORDER BY step_index ASC LIMIT ?
  `).all(taskId, since, Math.min(Number(limit) || 500, 2000));
}

// ─── Approvals ────────────────────────────────────────────────────

export function listPendingApprovals(db, userId) {
  if (!db || !userId) return [];
  return db.prepare(`
    SELECT a.*, t.title AS task_title, t.user_id
    FROM browser_task_approvals a INNER JOIN browser_tasks t ON t.id = a.task_id
    WHERE t.user_id = ? AND a.status = 'pending'
    ORDER BY a.created_at DESC LIMIT 100
  `).all(userId);
}

export function decideApproval(db, approvalId, { userId, decision, note = null }) {
  if (!db || !approvalId || !["approved","rejected"].includes(decision)) return { ok: false, reason: "invalid_args" };
  const row = db.prepare(`
    SELECT a.*, t.user_id AS task_user FROM browser_task_approvals a
    INNER JOIN browser_tasks t ON t.id = a.task_id
    WHERE a.id = ? AND a.status = 'pending'
  `).get(approvalId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.task_user !== userId) return { ok: false, reason: "forbidden" };
  db.prepare(`
    UPDATE browser_task_approvals
    SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?
    WHERE id = ?
  `).run(decision, userId, _now(), note ? String(note).slice(0, 1000) : null, approvalId);
  // If approved, drop task back to running so the orchestrator picks
  // it up on next tick. If rejected, mark task cancelled with a note.
  if (decision === "approved") {
    transitionTask(db, row.task_id, "running");
  } else {
    transitionTask(db, row.task_id, "cancelled", { result_summary: `User rejected step ${row.step_index}: ${note || ""}` });
  }
  return { ok: true, taskId: row.task_id };
}
