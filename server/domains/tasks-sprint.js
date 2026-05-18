// server/domains/tasks-sprint.js
//
// Tasks Sprint A — sprints / cycles + sprint membership +
// per-task labels + time tracking. Burndown + velocity are
// derived reads (no separate persistence).

import { randomUUID } from "node:crypto";
import { hasProjectRole, getTask, setLabels, getLabelsForTask } from "../lib/tasks/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }

export default function registerTasksSprintMacros(register) {

  // ─── Sprints ─────────────────────────────────────────────────────

  register("tasks", "sprint_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "member")) return { ok: false, reason: "forbidden" };
    const name = String(input.name || "").trim();
    if (!name) return { ok: false, reason: "name_required" };
    const id = `sprint:${randomUUID()}`;
    db.prepare(`
      INSERT INTO task_sprints (id, project_id, name, goal, status, start_at, end_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, name.slice(0, 120),
      input.goal ? String(input.goal).slice(0, 600) : null,
      input.status && ["planned","active","completed","archived"].includes(input.status) ? input.status : "planned",
      input.startAt ? Number(input.startAt) : null,
      input.endAt ? Number(input.endAt) : null,
      _now(), _now());
    return { ok: true, id };
  }, { destructive: true, note: "Create a sprint / cycle (member+)" });

  register("tasks", "sprint_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    const sprint = db.prepare(`SELECT project_id, status FROM task_sprints WHERE id = ?`).get(id);
    if (!sprint) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, sprint.project_id, userId, "member")) return { ok: false, reason: "forbidden" };
    const updates = [];
    const args = [];
    if (input.name) { updates.push("name = ?"); args.push(String(input.name).slice(0, 120)); }
    if (input.goal !== undefined) { updates.push("goal = ?"); args.push(input.goal ? String(input.goal).slice(0, 600) : null); }
    if (input.status && ["planned","active","completed","archived"].includes(input.status)) {
      updates.push("status = ?"); args.push(input.status);
      if (input.status === "completed" && sprint.status !== "completed") {
        updates.push("completed_at = ?"); args.push(_now());
      }
    }
    if (input.startAt !== undefined) { updates.push("start_at = ?"); args.push(input.startAt ? Number(input.startAt) : null); }
    if (input.endAt !== undefined) { updates.push("end_at = ?"); args.push(input.endAt ? Number(input.endAt) : null); }
    if (updates.length === 0) return { ok: false, reason: "nothing_to_update" };
    updates.push("updated_at = ?"); args.push(_now());
    args.push(id);
    db.prepare(`UPDATE task_sprints SET ${updates.join(", ")} WHERE id = ?`).run(...args);
    return { ok: true };
  }, { destructive: true, note: "Update a sprint (name, goal, status, dates)" });

  register("tasks", "sprint_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const status = input.status && ["planned","active","completed","archived"].includes(input.status) ? input.status : null;
    const sql = status
      ? `SELECT * FROM task_sprints WHERE project_id = ? AND status = ? ORDER BY start_at DESC NULLS LAST, created_at DESC`
      : `SELECT * FROM task_sprints WHERE project_id = ? ORDER BY status, start_at DESC NULLS LAST, created_at DESC`;
    const args = status ? [projectId, status] : [projectId];
    return { ok: true, sprints: db.prepare(sql).all(...args) };
  }, { note: "List sprints for a project (optionally filtered by status)" });

  register("tasks", "sprint_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    const sprint = db.prepare(`SELECT project_id FROM task_sprints WHERE id = ?`).get(id);
    if (!sprint) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, sprint.project_id, userId, "admin")) return { ok: false, reason: "forbidden" };
    db.prepare(`DELETE FROM task_sprints WHERE id = ?`).run(id);
    return { ok: true };
  }, { destructive: true, note: "Delete a sprint (admin+; tasks unaffected)" });

  register("tasks", "sprint_add_task", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const sprintId = String(input.sprintId || "");
    const taskId = String(input.taskId || "");
    const sprint = db.prepare(`SELECT project_id FROM task_sprints WHERE id = ?`).get(sprintId);
    if (!sprint) return { ok: false, reason: "sprint_not_found" };
    const task = getTask(db, taskId);
    if (!task) return { ok: false, reason: "task_not_found" };
    if (task.project_id !== sprint.project_id) return { ok: false, reason: "cross_project_not_allowed" };
    if (!hasProjectRole(db, sprint.project_id, userId, "member")) return { ok: false, reason: "forbidden" };
    db.prepare(`INSERT OR IGNORE INTO task_sprint_memberships (task_id, sprint_id, added_at) VALUES (?, ?, ?)`)
      .run(task.id, sprintId, _now());
    db.prepare(`INSERT INTO task_history (task_id, actor_id, action, after_value, created_at) VALUES (?, ?, 'sprinted', ?, ?)`)
      .run(task.id, userId, sprintId, _now());
    return { ok: true };
  }, { destructive: true, note: "Add a task to a sprint" });

  register("tasks", "sprint_remove_task", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const sprint = db.prepare(`SELECT project_id FROM task_sprints WHERE id = ?`).get(String(input.sprintId));
    if (!sprint) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, sprint.project_id, userId, "member")) return { ok: false, reason: "forbidden" };
    const r = db.prepare(`DELETE FROM task_sprint_memberships WHERE task_id = ? AND sprint_id = ?`).run(String(input.taskId), String(input.sprintId));
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Remove a task from a sprint" });

  register("tasks", "sprint_burndown", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const sprintId = String(input.sprintId || "");
    const sprint = db.prepare(`SELECT * FROM task_sprints WHERE id = ?`).get(sprintId);
    if (!sprint) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, sprint.project_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const tasks = db.prepare(`
      SELECT t.id, t.task_key, t.title, t.status_id, t.estimate, t.completed_at, t.created_at
      FROM tasks t INNER JOIN task_sprint_memberships sm ON sm.task_id = t.id
      WHERE sm.sprint_id = ? AND t.deleted_at IS NULL
    `).all(sprintId);
    const totalPoints = tasks.reduce((s, t) => s + (Number(t.estimate) || 0), 0);
    const completedTasks = tasks.filter((t) => t.completed_at != null);
    const completedPoints = completedTasks.reduce((s, t) => s + (Number(t.estimate) || 0), 0);
    const startTs = sprint.start_at || sprint.created_at;
    const endTs = sprint.end_at || (startTs + 14 * 86400);
    const now = _now();
    const totalDays = Math.max(1, Math.ceil((endTs - startTs) / 86400));
    const daysElapsed = Math.max(0, Math.min(totalDays, Math.floor((now - startTs) / 86400)));
    const idealRate = totalPoints / totalDays;
    const idealRemainingNow = Math.max(0, totalPoints - idealRate * daysElapsed);
    const actualRemaining = totalPoints - completedPoints;
    return {
      ok: true,
      sprint: { id: sprint.id, name: sprint.name, status: sprint.status, startAt: startTs, endAt: endTs },
      totalTasks: tasks.length,
      completedTasks: completedTasks.length,
      totalPoints,
      completedPoints,
      remainingPoints: actualRemaining,
      idealRate: Math.round(idealRate * 100) / 100,
      idealRemainingNow: Math.round(idealRemainingNow * 100) / 100,
      daysElapsed,
      totalDays,
      onTrack: actualRemaining <= idealRemainingNow + idealRate * 0.5,
      pacing: actualRemaining < idealRemainingNow ? "ahead" : actualRemaining > idealRemainingNow * 1.2 ? "behind" : "on-track",
    };
  }, { note: "Compute live burndown + pacing for a sprint" });

  // ─── Labels ──────────────────────────────────────────────────────

  register("tasks", "labels_set", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const taskId = String(input.taskId || "");
    const task = getTask(db, taskId);
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "member")) return { ok: false, reason: "forbidden" };
    setLabels(db, task.id, Array.isArray(input.labels) ? input.labels : []);
    return { ok: true, labels: getLabelsForTask(db, task.id) };
  }, { destructive: true, note: "Replace the label set on a task" });

  register("tasks", "labels_for_project", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const rows = db.prepare(`
      SELECT tl.label, COUNT(*) AS count
      FROM task_labels tl INNER JOIN tasks t ON t.id = tl.task_id
      WHERE t.project_id = ? AND t.deleted_at IS NULL
      GROUP BY tl.label ORDER BY count DESC, tl.label
    `).all(projectId);
    return { ok: true, labels: rows };
  }, { note: "Distinct labels in use on a project (with counts)" });

  // ─── Time tracking ───────────────────────────────────────────────

  register("tasks", "time_log", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const taskId = String(input.taskId || "");
    const seconds = Number(input.seconds);
    if (!taskId || !Number.isFinite(seconds) || seconds <= 0) return { ok: false, reason: "taskId_and_positive_seconds_required" };
    const task = getTask(db, taskId);
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "member")) return { ok: false, reason: "forbidden" };
    const r = db.prepare(`
      INSERT INTO task_time_entries (task_id, user_id, seconds, note, started_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(task.id, userId, Math.floor(seconds),
      input.note ? String(input.note).slice(0, 1000) : null,
      input.startedAt ? Number(input.startedAt) : _now(),
      _now());
    return { ok: true, id: r.lastInsertRowid };
  }, { destructive: true, note: "Log time spent on a task" });

  register("tasks", "time_entries", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const taskId = String(input.taskId || "");
    const task = getTask(db, taskId);
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const rows = db.prepare(`
      SELECT id, user_id, seconds, note, started_at, created_at
      FROM task_time_entries WHERE task_id = ? ORDER BY started_at DESC LIMIT ?
    `).all(task.id, Math.min(Number(input.limit) || 100, 500));
    const total = rows.reduce((s, r) => s + r.seconds, 0);
    return { ok: true, entries: rows, totalSeconds: total };
  }, { note: "List time entries for a task" });
}
