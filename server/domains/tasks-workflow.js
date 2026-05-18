// server/domains/tasks-workflow.js
//
// Tasks Sprint A — workflow + custom field CRUD (Jira-customisable
// shape). Per-project workflows + custom fields, both with full
// CRUD. Validation enforces unique status ids, known categories,
// and known field types.

import { randomUUID } from "node:crypto";
import { hasProjectRole } from "../lib/tasks/persistence.js";
import { defaultStatuses, validateStatuses } from "../lib/tasks/workflow.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }

const FIELD_TYPES = new Set(["text","number","select","multi_select","date","checkbox","url","user"]);

export default function registerTasksWorkflowMacros(register) {

  // ─── Workflows ───────────────────────────────────────────────────

  register("tasks", "workflow_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "admin")) return { ok: false, reason: "forbidden" };
    const name = String(input.name || "").trim();
    if (!name) return { ok: false, reason: "name_required" };
    const statuses = Array.isArray(input.statuses) && input.statuses.length > 0 ? input.statuses : defaultStatuses();
    const v = validateStatuses(statuses);
    if (!v.ok) return v;
    const id = `wf:${randomUUID()}`;
    const defaultStatusId = input.defaultStatusId && statuses.find((s) => s.id === input.defaultStatusId)
      ? input.defaultStatusId : statuses[0].id;
    db.prepare(`
      INSERT INTO task_workflows (id, project_id, name, statuses_json, transitions_json, default_status_id, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(id, projectId, name, JSON.stringify(statuses),
      input.transitions ? JSON.stringify(input.transitions) : null,
      defaultStatusId, _now(), _now());
    return { ok: true, id };
  }, { destructive: true, note: "Create a workflow under a project (admin+)" });

  register("tasks", "workflow_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const wf = db.prepare(`SELECT project_id, statuses_json FROM task_workflows WHERE id = ?`).get(id);
    if (!wf) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, wf.project_id, userId, "admin")) return { ok: false, reason: "forbidden" };
    if (input.statuses) {
      const v = validateStatuses(input.statuses);
      if (!v.ok) return v;
    }
    const updates = [];
    const args = [];
    if (input.name) { updates.push("name = ?"); args.push(String(input.name).slice(0, 120)); }
    if (input.statuses) { updates.push("statuses_json = ?"); args.push(JSON.stringify(input.statuses)); }
    if (input.transitions !== undefined) { updates.push("transitions_json = ?"); args.push(input.transitions ? JSON.stringify(input.transitions) : null); }
    if (input.defaultStatusId) { updates.push("default_status_id = ?"); args.push(input.defaultStatusId); }
    if (updates.length === 0) return { ok: false, reason: "nothing_to_update" };
    updates.push("updated_at = ?"); args.push(_now());
    args.push(id);
    db.prepare(`UPDATE task_workflows SET ${updates.join(", ")} WHERE id = ?`).run(...args);
    return { ok: true };
  }, { destructive: true, note: "Edit a workflow's statuses, transitions, name, or default status" });

  register("tasks", "workflow_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const rows = db.prepare(`SELECT * FROM task_workflows WHERE project_id = ? ORDER BY is_default DESC, created_at`).all(projectId);
    return {
      ok: true,
      workflows: rows.map((r) => ({
        ...r,
        statuses: (() => { try { return JSON.parse(r.statuses_json || "[]"); } catch { return []; } })(),
        transitions: (() => { try { return JSON.parse(r.transitions_json || "null"); } catch { return null; } })(),
      })),
    };
  }, { note: "List workflows for a project" });

  register("tasks", "workflow_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    const wf = db.prepare(`SELECT project_id, is_default FROM task_workflows WHERE id = ?`).get(id);
    if (!wf) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, wf.project_id, userId, "admin")) return { ok: false, reason: "forbidden" };
    if (wf.is_default) return { ok: false, reason: "cannot_delete_default_workflow" };
    const inUse = db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE workflow_id = ? AND deleted_at IS NULL`).get(id).n;
    if (inUse > 0) return { ok: false, reason: "workflow_in_use", taskCount: inUse };
    db.prepare(`DELETE FROM task_workflows WHERE id = ?`).run(id);
    return { ok: true };
  }, { destructive: true, note: "Delete a non-default, unused workflow" });

  // ─── Custom fields ───────────────────────────────────────────────

  register("tasks", "custom_field_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "admin")) return { ok: false, reason: "forbidden" };
    const key = String(input.key || "").trim();
    const label = String(input.label || "").trim();
    const type = String(input.type || "");
    if (!key || !label) return { ok: false, reason: "key_and_label_required" };
    if (!FIELD_TYPES.has(type)) return { ok: false, reason: "unknown_type" };
    const id = `cf:${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO task_custom_fields (id, project_id, key, label, type, options_json, required, position, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, projectId, key.slice(0, 60), label.slice(0, 120), type,
        input.options ? JSON.stringify(input.options) : null,
        input.required ? 1 : 0,
        Number(input.position) || 0,
        _now());
      return { ok: true, id };
    } catch (err) {
      if (String(err?.message || "").includes("UNIQUE")) return { ok: false, reason: "key_taken" };
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Add a custom field to a project (admin+)" });

  register("tasks", "custom_field_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const projectId = String(input.projectId || "");
    if (!hasProjectRole(db, projectId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const rows = db.prepare(`SELECT * FROM task_custom_fields WHERE project_id = ? ORDER BY position ASC`).all(projectId);
    return {
      ok: true,
      fields: rows.map((r) => ({ ...r, options: (() => { try { return JSON.parse(r.options_json || "null"); } catch { return null; } })() })),
    };
  }, { note: "List custom fields for a project" });

  register("tasks", "custom_field_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    const cf = db.prepare(`SELECT project_id FROM task_custom_fields WHERE id = ?`).get(id);
    if (!cf) return { ok: false, reason: "not_found" };
    if (!hasProjectRole(db, cf.project_id, userId, "admin")) return { ok: false, reason: "forbidden" };
    db.prepare(`DELETE FROM task_custom_fields WHERE id = ?`).run(id);
    return { ok: true };
  }, { destructive: true, note: "Delete a custom field (admin+)" });
}
