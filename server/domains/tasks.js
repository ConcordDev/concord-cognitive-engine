// server/domains/tasks.js
//
// Tasks lens Sprint A — Jira-customisable substrate (migration 214).
//
// Replaces the legacy projects.js scaffold (which had 4 pure-math
// macros + was never imported into server.js — smoking-gun 6/6).
// This file exposes ~22 macros covering project + task CRUD,
// workflows, custom fields, labels, dependencies, search, with
// real DB persistence + history audit trail.
//
// Sister domains (loaded alongside): tasks-sprint, tasks-collab,
// tasks-views. Total Sprint A macro count ≈ 35.

import { randomUUID } from "node:crypto";
import {
  createProject, getProject, getProjectByKey, listProjectsForUser, updateProject, deleteProject,
  getProjectRole, hasProjectRole, inviteMember, listMembers,
  createTask, getTask, updateTask, softDeleteTask, listTasks,
  getLabelsForTask, setLabels, getParticipants, getDependencies, getHistory,
} from "../lib/tasks/persistence.js";
import { defaultStatuses, validateStatuses, validateTransition, statusById, statusesAsArray } from "../lib/tasks/workflow.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _emit(event, payload) {
  try { globalThis._concordREALTIME?.io?.to(`task:${payload.taskId || payload.projectId}`).emit(event, payload); }
  catch { /* best effort */ }
}
function _now() { return Math.floor(Date.now() / 1000); }

export default function registerTasksMacros(register) {

  // ─── Projects ────────────────────────────────────────────────────

  register("tasks", "project_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = createProject(db, {
      ownerId: userId,
      key: input.key,
      name: input.name,
      description: input.description,
      icon: input.icon,
      color: input.color,
      visibility: input.visibility || "private",
    });
    if (r.ok) _emit("task:project-created", { projectId: r.id, ownerId: userId });
    return r;
  }, { destructive: true, note: "Create a project (seeds default workflow + owner row)" });

  register("tasks", "project_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const id = String(input.id || input.projectId || "");
    if (!id) return { ok: false, reason: "id_required" };
    const proj = getProject(db, id);
    if (!proj) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, project: proj };
  }, { note: "Get a project by id" });

  register("tasks", "project_get_by_key", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const key = String(input.key || "").toUpperCase();
    if (!key) return { ok: false, reason: "key_required" };
    const proj = getProjectByKey(db, key);
    if (!proj) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, proj.id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, project: proj };
  }, { note: "Get a project by short key (WEB / MOBILE / etc.)" });

  register("tasks", "project_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projects = listProjectsForUser(db, userId, { limit: Math.min(Number(input.limit) || 200, 500) });
    return { ok: true, projects, count: projects.length };
  }, { note: "List projects I'm a member of" });

  register("tasks", "project_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    if (!hasProjectRole(db, id, userId, "admin")) return { ok: false, reason: "forbidden" };
    return updateProject(db, id, input);
  }, { destructive: true, note: "Update project metadata (admin+)" });

  register("tasks", "project_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return deleteProject(db, String(input.id || ""), userId);
  }, { destructive: true, note: "Soft-delete a project (owner only)" });

  register("tasks", "project_invite", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return inviteMember(db, {
      projectId: String(input.projectId || ""),
      userId: String(input.userId || ""),
      role: input.role || "member",
      invitedBy: userId,
    });
  }, { destructive: true, note: "Invite a member to a project (admin+)" });

  register("tasks", "project_members", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, members: listMembers(db, projectId) };
  }, { note: "List project members" });

  // ─── Tasks ───────────────────────────────────────────────────────

  register("tasks", "task_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "member")) return { ok: false, reason: "forbidden" };
    const r = createTask(db, {
      projectId, reporterId: userId,
      title: input.title,
      descriptionHtml: input.descriptionHtml || input.description,
      type: input.type,
      priority: input.priority,
      statusId: input.statusId,
      workflowId: input.workflowId,
      parentId: input.parentId,
      assigneeId: input.assigneeId,
      dueAt: input.dueAt,
      estimate: input.estimate,
      estimateUnit: input.estimateUnit,
      customFields: input.customFields,
      labels: input.labels,
    });
    if (r.ok) _emit("task:created", { taskId: r.id, taskKey: r.taskKey, projectId, by: userId });
    return r;
  }, { destructive: true, note: "Create a task (member+)" });

  register("tasks", "task_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.id || input.key || ""));
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return {
      ok: true,
      task: {
        ...task,
        labels: getLabelsForTask(db, task.id),
        participants: getParticipants(db, task.id),
        dependencies: getDependencies(db, task.id),
      },
    };
  }, { note: "Get a task by id or task_key (e.g. WEB-42)" });

  register("tasks", "task_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const task = getTask(db, id);
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "member")) return { ok: false, reason: "forbidden" };

    // Validate workflow transitions if status is changing
    if (input.statusId && input.statusId !== task.status_id) {
      const wf = db.prepare(`SELECT * FROM task_workflows WHERE id = ?`).get(task.workflow_id);
      const v = validateTransition(wf, task.status_id, input.statusId);
      if (!v.ok) return v;
      // Auto-stamp completed_at when entering a done category
      const newStatus = statusById(wf, input.statusId);
      if (newStatus?.category === "done" && !task.completed_at) {
        input.completedAt = _now();
      } else if (newStatus?.category !== "done" && task.completed_at) {
        input.completedAt = null;
      }
    }

    const r = updateTask(db, id, userId, input);
    if (r.ok) {
      if (Array.isArray(input.labels)) setLabels(db, id, input.labels);
      _emit("task:updated", { taskId: id, by: userId });
    }
    return r;
  }, { destructive: true, note: "Update task fields with workflow + status auto-completion" });

  register("tasks", "task_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = softDeleteTask(db, String(input.id || ""), userId);
    if (r.ok) _emit("task:deleted", { taskId: input.id });
    return r;
  }, { destructive: true, note: "Soft-delete a task (member+)" });

  register("tasks", "task_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    if (input.projectId && !hasProjectRole(db, input.projectId, userId, "viewer")) {
      return { ok: false, reason: "forbidden" };
    }
    const tasks = listTasks(db, input);
    return { ok: true, tasks, count: tasks.length };
  }, { note: "List tasks with filters (project, status, assignee, parent, sprint, labels, search)" });

  register("tasks", "task_assigned_to_me", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const tasks = listTasks(db, { assigneeId: userId, limit: Math.min(Number(input.limit) || 100, 200) });
    return { ok: true, tasks, count: tasks.length };
  }, { note: "List tasks assigned to me across all projects" });

  register("tasks", "task_subtasks", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const parentId = String(input.parentId || "");
    if (!parentId) return { ok: false, reason: "parentId_required" };
    const parent = getTask(db, parentId);
    if (!parent) return { ok: false, reason: "parent_not_found" };
    if (!hasProjectRole(db, parent.project_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, subtasks: listTasks(db, { parentId, limit: 200 }) };
  }, { note: "List subtasks of a parent task" });

  register("tasks", "task_history", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.taskId || input.id || "");
    const task = getTask(db, id);
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, history: getHistory(db, task.id, { limit: Math.min(Number(input.limit) || 100, 500) }) };
  }, { note: "Audit trail for a task" });

  register("tasks", "task_bulk_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const ids = Array.isArray(input.ids) ? input.ids.map(String).slice(0, 200) : [];
    if (ids.length === 0) return { ok: false, reason: "ids_required" };
    const patch = input.patch || {};
    let updated = 0;
    for (const id of ids) {
      const t = getTask(db, id);
      if (!t) continue;
      if (!hasProjectRole(db, t.project_id, userId, "member")) continue;
      const r = updateTask(db, id, userId, patch);
      if (r.ok) updated++;
    }
    return { ok: true, updated, total: ids.length };
  }, { destructive: true, note: "Bulk update up to 200 tasks (status, priority, assignee, labels)" });

  // ─── Dependencies ────────────────────────────────────────────────

  register("tasks", "dependency_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const blockerId = String(input.blockerId || "");
    const blockedId = String(input.blockedId || "");
    if (!blockerId || !blockedId) return { ok: false, reason: "ids_required" };
    if (blockerId === blockedId) return { ok: false, reason: "self_dependency_not_allowed" };
    const kind = input.kind && ["blocks","relates_to","duplicates","clones"].includes(input.kind) ? input.kind : "blocks";
    const t1 = getTask(db, blockerId);
    const t2 = getTask(db, blockedId);
    if (!t1 || !t2) return { ok: false, reason: "task_not_found" };
    if (!hasProjectRole(db, t1.project_id, userId, "member")) return { ok: false, reason: "forbidden" };
    try {
      db.prepare(`
        INSERT INTO task_dependencies (blocker_id, blocked_id, kind, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(blocker_id, blocked_id, kind) DO NOTHING
      `).run(blockerId, blockedId, kind, userId, _now());
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Link two tasks (blocks / relates_to / duplicates / clones)" });

  register("tasks", "dependency_remove", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const t = getTask(db, String(input.blockerId || ""));
    if (!t) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, t.project_id, userId, "member")) return { ok: false, reason: "forbidden" };
    const r = db.prepare(`DELETE FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ? AND kind = ?`)
      .run(String(input.blockerId), String(input.blockedId), input.kind || "blocks");
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Remove a dependency" });

  // ─── Search ──────────────────────────────────────────────────────

  register("tasks", "search", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const q = String(input.query || "").trim();
    if (q.length < 2) return { ok: true, results: [] };
    // Scope to projects the user is a member of
    const memberProjects = db.prepare(`SELECT project_id FROM project_members WHERE user_id = ?`).all(userId).map((r) => r.project_id);
    if (memberProjects.length === 0) return { ok: true, results: [] };
    const placeholders = memberProjects.map(() => "?").join(", ");
    const rows = db.prepare(`
      SELECT id, task_key, title, status_id, priority, assignee_id, project_id, updated_at,
             substr(description_html, 1, 240) AS preview
      FROM tasks
      WHERE project_id IN (${placeholders})
        AND deleted_at IS NULL
        AND (LOWER(title) LIKE ? OR LOWER(task_key) LIKE ? OR LOWER(description_html) LIKE ?)
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...memberProjects, `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`,
      Math.min(Number(input.limit) || 25, 100));
    return { ok: true, results: rows };
  }, { note: "Substring search across my projects' tasks" });
}
