// server/domains/tasks-collab.js
//
// Tasks Sprint A — collaboration: comments + attachments + links +
// participants (multi-assignee / watcher / reviewer / requester).

import { randomUUID } from "node:crypto";
import { hasProjectRole, getTask } from "../lib/tasks/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _emit(event, payload) {
  try { globalThis._concordREALTIME?.io?.to(`task:${payload.taskId}`).emit(event, payload); } catch { /* best */ }
}
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

const ROLES = new Set(["assignee","watcher","reviewer","requester"]);

export default function registerTasksCollabMacros(register) {

  // ─── Comments ────────────────────────────────────────────────────

  register("tasks", "comment_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const taskId = String(input.taskId || "");
    const body = String(input.body || "").trim();
    if (!taskId || !body) return { ok: false, reason: "taskId_and_body_required" };
    if (body.length > 8000) return { ok: false, reason: "body_too_long" };
    const task = getTask(db, taskId);
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const id = `tcmt:${randomUUID()}`;
    const threadId = input.threadId || id;
    db.prepare(`
      INSERT INTO task_comments (id, task_id, thread_id, author_id, body, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, task.id, threadId, userId, body, _now(), _now());
    db.prepare(`INSERT INTO task_history (task_id, actor_id, action, after_value, created_at) VALUES (?, ?, 'commented', ?, ?)`)
      .run(task.id, userId, body.slice(0, 200), _now());
    _emit("task:comment-added", { taskId: task.id, commentId: id, threadId, by: userId, body });
    return { ok: true, id, threadId };
  }, { destructive: true, note: "Add a comment to a task (or reply via threadId)" });

  register("tasks", "comment_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const taskId = String(input.taskId || "");
    const task = getTask(db, taskId);
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const sql = input.onlyUnresolved
      ? `SELECT * FROM task_comments WHERE task_id = ? AND resolved = 0 ORDER BY created_at ASC LIMIT 500`
      : `SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC LIMIT 500`;
    const rows = db.prepare(sql).all(task.id).map((r) => ({ ...r, reactions: _safeJson(r.reactions_json, {}) }));
    return { ok: true, comments: rows };
  }, { note: "List comments for a task" });

  register("tasks", "comment_resolve", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const commentId = String(input.commentId || "");
    const row = db.prepare(`SELECT task_id FROM task_comments WHERE id = ?`).get(commentId);
    if (!row) return { ok: false, reason: "not_found" };
    const task = getTask(db, row.task_id);
    if (!task || !hasProjectRole(db, task.project_id, userId, "member")) return { ok: false, reason: "forbidden" };
    const r = db.prepare(`UPDATE task_comments SET resolved = 1, resolved_by = ?, updated_at = ? WHERE id = ?`)
      .run(userId, _now(), commentId);
    if (r.changes > 0) _emit("task:comment-resolved", { taskId: task.id, commentId, by: userId });
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Resolve a comment thread" });

  // ─── Participants ────────────────────────────────────────────────

  register("tasks", "participant_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const taskId = String(input.taskId || "");
    const addUserId = String(input.userId || "");
    const role = ROLES.has(input.role) ? input.role : "watcher";
    const task = getTask(db, taskId);
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "member")) return { ok: false, reason: "forbidden" };
    db.prepare(`
      INSERT INTO task_participants (task_id, user_id, role, added_by, added_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(task_id, user_id, role) DO NOTHING
    `).run(task.id, addUserId, role, userId, _now());
    return { ok: true };
  }, { destructive: true, note: "Add a participant (assignee/watcher/reviewer/requester)" });

  register("tasks", "participant_remove", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.taskId || ""));
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "member")) return { ok: false, reason: "forbidden" };
    const r = db.prepare(`DELETE FROM task_participants WHERE task_id = ? AND user_id = ? AND role = ?`)
      .run(task.id, String(input.userId), input.role || "watcher");
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Remove a participant role" });

  register("tasks", "participant_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.taskId || ""));
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const rows = db.prepare(`SELECT user_id, role, added_at FROM task_participants WHERE task_id = ?`).all(task.id);
    return { ok: true, participants: rows };
  }, { note: "List participants on a task" });

  // ─── Attachments ─────────────────────────────────────────────────

  register("tasks", "attachment_record", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.taskId || ""));
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "member")) return { ok: false, reason: "forbidden" };
    const id = `tatt:${randomUUID()}`;
    db.prepare(`
      INSERT INTO task_attachments (id, task_id, uploader_id, url, filename, mime_type, byte_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, task.id, userId,
      String(input.url || ""),
      input.filename ? String(input.filename).slice(0, 240) : null,
      input.mimeType ? String(input.mimeType).slice(0, 120) : null,
      input.byteSize != null ? Number(input.byteSize) : null,
      _now());
    db.prepare(`INSERT INTO task_history (task_id, actor_id, action, after_value, created_at) VALUES (?, ?, 'attached', ?, ?)`)
      .run(task.id, userId, input.filename || input.url, _now());
    return { ok: true, id };
  }, { destructive: true, note: "Record an attachment on a task (URL already minted elsewhere)" });

  register("tasks", "attachment_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.taskId || ""));
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, attachments: db.prepare(`SELECT * FROM task_attachments WHERE task_id = ? ORDER BY created_at DESC`).all(task.id) };
  }, { note: "List attachments on a task" });

  // ─── Cross-app links ─────────────────────────────────────────────

  register("tasks", "link_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.taskId || ""));
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "member")) return { ok: false, reason: "forbidden" };
    const kind = ["doc","dtu","lens","external","pr","commit","task"].includes(input.kind) ? input.kind : null;
    if (!kind) return { ok: false, reason: "unknown_kind" };
    if (!input.targetId && !input.targetUri) return { ok: false, reason: "target_required" };
    const r = db.prepare(`
      INSERT INTO task_links (task_id, target_kind, target_id, target_uri, target_label, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(task.id, kind,
      input.targetId ? String(input.targetId) : null,
      input.targetUri ? String(input.targetUri) : null,
      input.label ? String(input.label).slice(0, 200) : null,
      userId, _now());
    return { ok: true, id: r.lastInsertRowid };
  }, { destructive: true, note: "Link a task to a doc / DTU / lens / external URL / PR / commit / other task" });

  register("tasks", "link_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = getTask(db, String(input.taskId || ""));
    if (!task) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, task.project_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, links: db.prepare(`SELECT * FROM task_links WHERE task_id = ? ORDER BY created_at DESC`).all(task.id) };
  }, { note: "List cross-app links on a task" });

  register("tasks", "link_remove", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const linkId = Number(input.id);
    const row = db.prepare(`SELECT task_id FROM task_links WHERE id = ?`).get(linkId);
    if (!row) return { ok: false, reason: "not_found" };
    const task = getTask(db, row.task_id);
    if (!hasProjectRole(db, task.project_id, userId, "member")) return { ok: false, reason: "forbidden" };
    db.prepare(`DELETE FROM task_links WHERE id = ?`).run(linkId);
    return { ok: true };
  }, { destructive: true, note: "Remove a cross-app link" });
}
