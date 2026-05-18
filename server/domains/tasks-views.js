// server/domains/tasks-views.js
//
// Tasks Sprint A — saved views. List / board / calendar / timeline /
// gallery views. Per-user persistence with filters + sort + group_by.

import { randomUUID } from "node:crypto";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

const VIEW_KINDS = new Set(["list","board","calendar","timeline","gallery"]);

export default function registerTasksViewsMacros(register) {

  register("tasks", "view_save", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const name = String(input.name || "").trim();
    if (!name) return { ok: false, reason: "name_required" };
    const viewKind = VIEW_KINDS.has(input.viewKind) ? input.viewKind : "list";
    const id = input.id ? String(input.id) : `view:${randomUUID()}`;
    db.prepare(`
      INSERT INTO task_saved_views (id, owner_id, project_id, name, view_kind, filters_json, sort_json, group_by, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        view_kind = excluded.view_kind,
        filters_json = excluded.filters_json,
        sort_json = excluded.sort_json,
        group_by = excluded.group_by,
        is_default = excluded.is_default,
        updated_at = excluded.updated_at
    `).run(id, userId,
      input.projectId || null,
      name.slice(0, 120),
      viewKind,
      input.filters ? JSON.stringify(input.filters) : null,
      input.sort ? JSON.stringify(input.sort) : null,
      input.groupBy ? String(input.groupBy).slice(0, 60) : null,
      input.isDefault ? 1 : 0,
      _now(), _now());
    return { ok: true, id };
  }, { destructive: true, note: "Save (or upsert) a custom view" });

  register("tasks", "view_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = input.projectId || null;
    const rows = projectId
      ? db.prepare(`SELECT * FROM task_saved_views WHERE owner_id = ? AND (project_id IS NULL OR project_id = ?) ORDER BY is_default DESC, updated_at DESC`).all(userId, projectId)
      : db.prepare(`SELECT * FROM task_saved_views WHERE owner_id = ? ORDER BY is_default DESC, updated_at DESC`).all(userId);
    return {
      ok: true,
      views: rows.map((r) => ({
        ...r,
        filters: _safeJson(r.filters_json, null),
        sort: _safeJson(r.sort_json, null),
      })),
    };
  }, { note: "List my saved views (optionally project-scoped)" });

  register("tasks", "view_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = db.prepare(`DELETE FROM task_saved_views WHERE id = ? AND owner_id = ?`).run(String(input.id), userId);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Delete a saved view (owner only)" });

  register("tasks", "view_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const row = db.prepare(`SELECT * FROM task_saved_views WHERE id = ? AND owner_id = ?`).get(String(input.id), userId);
    if (!row) return { ok: false, reason: "not_found" };
    return { ok: true, view: { ...row, filters: _safeJson(row.filters_json, null), sort: _safeJson(row.sort_json, null) } };
  }, { note: "Get a saved view (owner-scoped)" });
}
