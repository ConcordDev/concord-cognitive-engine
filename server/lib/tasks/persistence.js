// server/lib/tasks/persistence.js
//
// Tasks Sprint A — DB persistence layer for the migration-214
// substrate. Same shape as docs/persistence.js: role enforcement,
// soft-delete semantics, transactional writes for multi-table
// operations (e.g. createProject seeds the default workflow +
// members row in one transaction).

import { randomUUID } from "node:crypto";
import { defaultWorkflow, defaultStatuses } from "./workflow.js";

export const ROLE_RANK = { owner: 5, admin: 4, member: 3, viewer: 1 };

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
const TITLE_MAX = 240;
const DESC_MAX = 500_000;

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }
function _normalisePriority(p) {
  const x = String(p || "medium").toLowerCase();
  return ["urgent","high","medium","low","none"].includes(x) ? x : "medium";
}
function _normaliseType(t) {
  const x = String(t || "task").toLowerCase();
  return ["task","bug","feature","epic","story","spike","chore"].includes(x) ? x : "task";
}

// ─── Projects ──────────────────────────────────────────────────────

export function createProject(db, { ownerId, key, name, description = null, icon = null, color = null, visibility = "private" }) {
  if (!db || !ownerId || !key || !name) return { ok: false, reason: "missing_args" };
  const cleanKey = String(key || "").trim();
  if (!KEY_RE.test(cleanKey)) return { ok: false, reason: "key_must_be_uppercase_2_to_10_chars" };
  const id = `proj:${randomUUID()}`;
  const wf = defaultWorkflow(id);
  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO projects (id, owner_id, key, name, description, icon, color, visibility, default_workflow_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ownerId, cleanKey, String(name).slice(0, 200),
        description ? String(description).slice(0, 2000) : null,
        icon ? String(icon).slice(0, 8) : null,
        color ? String(color).slice(0, 16) : "#22d3ee",
        visibility, wf.id, _now(), _now());
      db.prepare(`
        INSERT INTO project_members (project_id, user_id, role, invited_by, invited_at)
        VALUES (?, ?, 'owner', ?, ?)
      `).run(id, ownerId, ownerId, _now());
      db.prepare(`
        INSERT INTO task_workflows (id, project_id, name, statuses_json, transitions_json, default_status_id, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(wf.id, id, wf.name, wf.statuses_json, wf.transitions_json, wf.default_status_id, _now(), _now());
    });
    tx();
    return { ok: true, id, key: cleanKey, workflowId: wf.id };
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE constraint failed: projects.key")) {
      return { ok: false, reason: "key_taken" };
    }
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getProject(db, id) {
  if (!db || !id) return null;
  const row = db.prepare(`SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL`).get(id);
  return row ? { ...row, settings: _safeJson(row.settings_json, {}) } : null;
}

export function getProjectByKey(db, key) {
  if (!db || !key) return null;
  return db.prepare(`SELECT * FROM projects WHERE key = ? AND deleted_at IS NULL`).get(String(key).toUpperCase());
}

export function listProjectsForUser(db, userId, { limit = 200 } = {}) {
  if (!db || !userId) return [];
  return db.prepare(`
    SELECT p.*, pm.role
    FROM projects p
    INNER JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.user_id = ? AND p.deleted_at IS NULL
    ORDER BY p.updated_at DESC LIMIT ?
  `).all(userId, limit);
}

export function updateProject(db, id, patch = {}) {
  if (!db || !id) return { ok: false, reason: "missing_args" };
  const updates = [];
  const args = [];
  if (patch.name !== undefined) { updates.push("name = ?"); args.push(String(patch.name).slice(0, 200)); }
  if (patch.description !== undefined) { updates.push("description = ?"); args.push(patch.description ? String(patch.description).slice(0, 2000) : null); }
  if (patch.icon !== undefined) { updates.push("icon = ?"); args.push(patch.icon ? String(patch.icon).slice(0, 8) : null); }
  if (patch.color !== undefined) { updates.push("color = ?"); args.push(patch.color ? String(patch.color).slice(0, 16) : null); }
  if (patch.visibility && ["private","team","workspace","public"].includes(patch.visibility)) { updates.push("visibility = ?"); args.push(patch.visibility); }
  if (patch.settings !== undefined) { updates.push("settings_json = ?"); args.push(JSON.stringify(patch.settings || {})); }
  if (updates.length === 0) return { ok: false, reason: "nothing_to_update" };
  updates.push("updated_at = ?"); args.push(_now());
  args.push(id);
  db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(...args);
  return { ok: true };
}

export function deleteProject(db, id, actorId) {
  const role = getProjectRole(db, id, actorId);
  if (role !== "owner") return { ok: false, reason: "forbidden" };
  const r = db.prepare(`UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(_now(), _now(), id);
  return { ok: r.changes > 0 };
}

// ─── Members / roles ───────────────────────────────────────────────

export function getProjectRole(db, projectId, userId) {
  if (!db || !projectId || !userId) return null;
  const row = db.prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`).get(projectId, userId);
  if (row) return row.role;
  const p = db.prepare(`SELECT visibility FROM projects WHERE id = ?`).get(projectId);
  if (p?.visibility === "public" || p?.visibility === "workspace") return "viewer";
  return null;
}

export function hasProjectRole(db, projectId, userId, minRole) {
  const r = getProjectRole(db, projectId, userId);
  if (!r) return false;
  return (ROLE_RANK[r] || 0) >= (ROLE_RANK[minRole] || 0);
}

export function inviteMember(db, { projectId, userId, role = "member", invitedBy }) {
  if (!hasProjectRole(db, projectId, invitedBy, "admin")) return { ok: false, reason: "forbidden" };
  if (!ROLE_RANK[role]) return { ok: false, reason: "invalid_role" };
  db.prepare(`
    INSERT INTO project_members (project_id, user_id, role, invited_by, invited_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role
  `).run(projectId, userId, role, invitedBy, _now());
  return { ok: true };
}

export function listMembers(db, projectId) {
  if (!db) return [];
  return db.prepare(`SELECT user_id, role, invited_at FROM project_members WHERE project_id = ? ORDER BY invited_at`).all(projectId);
}

// ─── Tasks ─────────────────────────────────────────────────────────

export function nextTaskKey(db, projectId) {
  if (!db || !projectId) return null;
  const p = db.prepare(`SELECT key, next_task_number FROM projects WHERE id = ?`).get(projectId);
  if (!p) return null;
  const key = `${p.key}-${p.next_task_number}`;
  db.prepare(`UPDATE projects SET next_task_number = next_task_number + 1, updated_at = ? WHERE id = ?`).run(_now(), projectId);
  return key;
}

export function createTask(db, {
  projectId, reporterId, title, descriptionHtml = "", type = "task",
  priority = "medium", statusId = null, workflowId = null, parentId = null,
  assigneeId = null, dueAt = null, estimate = null, estimateUnit = "points",
  customFields = null, labels = [],
}) {
  if (!db || !projectId || !reporterId || !title) return { ok: false, reason: "missing_args" };
  const project = db.prepare(`SELECT default_workflow_id FROM projects WHERE id = ? AND deleted_at IS NULL`).get(projectId);
  if (!project) return { ok: false, reason: "project_not_found" };
  const wfId = workflowId || project.default_workflow_id;
  const wf = db.prepare(`SELECT default_status_id FROM task_workflows WHERE id = ?`).get(wfId);
  if (!wf) return { ok: false, reason: "workflow_not_found" };
  const stId = statusId || wf.default_status_id;

  const id = `task:${randomUUID()}`;
  const taskKey = nextTaskKey(db, projectId);
  if (!taskKey) return { ok: false, reason: "key_gen_failed" };

  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO tasks (id, project_id, task_key, parent_id, type, title, description_html,
                          status_id, workflow_id, priority, estimate, estimate_unit,
                          reporter_id, assignee_id, due_at, position, custom_fields_json,
                          created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, projectId, taskKey, parentId, _normaliseType(type),
        String(title).slice(0, TITLE_MAX),
        descriptionHtml ? String(descriptionHtml).slice(0, DESC_MAX) : null,
        stId, wfId, _normalisePriority(priority),
        estimate != null ? Number(estimate) : null,
        ["points","hours"].includes(estimateUnit) ? estimateUnit : "points",
        reporterId, assigneeId,
        dueAt ? Number(dueAt) : null,
        _now(),
        customFields ? JSON.stringify(customFields) : null,
        _now(), _now());

      // Reporter is always a watcher
      db.prepare(`INSERT OR IGNORE INTO task_participants (task_id, user_id, role, added_by, added_at) VALUES (?, ?, 'watcher', ?, ?)`)
        .run(id, reporterId, reporterId, _now());
      // Assignee row
      if (assigneeId) {
        db.prepare(`INSERT OR IGNORE INTO task_participants (task_id, user_id, role, added_by, added_at) VALUES (?, ?, 'assignee', ?, ?)`)
          .run(id, assigneeId, reporterId, _now());
      }
      // Labels
      if (Array.isArray(labels)) {
        for (const lab of labels) {
          if (lab) db.prepare(`INSERT OR IGNORE INTO task_labels (task_id, label) VALUES (?, ?)`).run(id, String(lab).slice(0, 80));
        }
      }
      // History
      db.prepare(`INSERT INTO task_history (task_id, actor_id, action, after_value, created_at) VALUES (?, ?, 'created', ?, ?)`)
        .run(id, reporterId, JSON.stringify({ title, statusId: stId, priority }), _now());
    });
    tx();
    return { ok: true, id, taskKey };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getTask(db, idOrKey) {
  if (!db || !idOrKey) return null;
  const row = idOrKey.includes("-") && !idOrKey.startsWith("task:")
    ? db.prepare(`SELECT * FROM tasks WHERE task_key = ? AND deleted_at IS NULL`).get(idOrKey)
    : db.prepare(`SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL`).get(idOrKey);
  if (!row) return null;
  return { ...row, customFields: _safeJson(row.custom_fields_json, {}) };
}

export function updateTask(db, id, actorId, patch = {}) {
  if (!db || !id) return { ok: false, reason: "missing_args" };
  const current = db.prepare(`SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!current) return { ok: false, reason: "not_found" };

  const updates = [];
  const args = [];
  const histEntries = [];

  if (patch.title !== undefined && patch.title !== current.title) {
    updates.push("title = ?"); args.push(String(patch.title).slice(0, TITLE_MAX));
    histEntries.push({ action: "retitled", field: "title", before: current.title, after: patch.title });
  }
  if (patch.descriptionHtml !== undefined) {
    updates.push("description_html = ?"); args.push(patch.descriptionHtml ? String(patch.descriptionHtml).slice(0, DESC_MAX) : null);
    histEntries.push({ action: "described", field: "description" });
  }
  if (patch.statusId !== undefined && patch.statusId !== current.status_id) {
    updates.push("status_id = ?"); args.push(patch.statusId);
    histEntries.push({ action: "status_changed", field: "status_id", before: current.status_id, after: patch.statusId });
    // Auto-stamp completed_at on a done-category status (caller decides via patch.completedAt; we just record when explicitly set)
  }
  if (patch.completedAt !== undefined) {
    updates.push("completed_at = ?"); args.push(patch.completedAt ? Number(patch.completedAt) : null);
  }
  if (patch.priority !== undefined && patch.priority !== current.priority) {
    updates.push("priority = ?"); args.push(_normalisePriority(patch.priority));
    histEntries.push({ action: "reprioritized", field: "priority", before: current.priority, after: patch.priority });
  }
  if (patch.assigneeId !== undefined && patch.assigneeId !== current.assignee_id) {
    updates.push("assignee_id = ?"); args.push(patch.assigneeId || null);
    histEntries.push({ action: "assigned", field: "assignee_id", before: current.assignee_id, after: patch.assigneeId });
  }
  if (patch.type !== undefined) { updates.push("type = ?"); args.push(_normaliseType(patch.type)); }
  if (patch.estimate !== undefined) { updates.push("estimate = ?"); args.push(patch.estimate != null ? Number(patch.estimate) : null); }
  if (patch.estimateUnit !== undefined && ["points","hours"].includes(patch.estimateUnit)) {
    updates.push("estimate_unit = ?"); args.push(patch.estimateUnit);
  }
  if (patch.dueAt !== undefined) { updates.push("due_at = ?"); args.push(patch.dueAt ? Number(patch.dueAt) : null); }
  if (patch.position !== undefined) { updates.push("position = ?"); args.push(Number(patch.position)); }
  if (patch.parentId !== undefined) { updates.push("parent_id = ?"); args.push(patch.parentId || null); }
  if (patch.customFields !== undefined) { updates.push("custom_fields_json = ?"); args.push(JSON.stringify(patch.customFields || {})); }
  if (updates.length === 0) return { ok: false, reason: "nothing_to_update" };

  updates.push("updated_at = ?"); args.push(_now());
  args.push(id);

  try {
    const tx = db.transaction(() => {
      db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...args);
      for (const h of histEntries) {
        db.prepare(`INSERT INTO task_history (task_id, actor_id, action, field, before_value, after_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(id, actorId, h.action, h.field, h.before != null ? String(h.before) : null, h.after != null ? String(h.after) : null, _now());
      }
      // Assignee participant row sync
      if (patch.assigneeId !== undefined) {
        if (current.assignee_id) {
          db.prepare(`DELETE FROM task_participants WHERE task_id = ? AND user_id = ? AND role = 'assignee'`).run(id, current.assignee_id);
        }
        if (patch.assigneeId) {
          db.prepare(`INSERT OR IGNORE INTO task_participants (task_id, user_id, role, added_by, added_at) VALUES (?, ?, 'assignee', ?, ?)`)
            .run(id, patch.assigneeId, actorId, _now());
        }
      }
    });
    tx();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "update_failed", error: err?.message };
  }
}

export function softDeleteTask(db, id, actorId) {
  if (!db || !id) return { ok: false, reason: "missing_args" };
  const row = db.prepare(`SELECT project_id FROM tasks WHERE id = ?`).get(id);
  if (!row) return { ok: false, reason: "not_found" };
  if (!hasProjectRole(db, row.project_id, actorId, "member")) return { ok: false, reason: "forbidden" };
  const r = db.prepare(`UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`).run(_now(), _now(), id);
  return { ok: r.changes > 0 };
}

export function listTasks(db, { projectId, statusId, assigneeId, parentId, sprintId, labels, search, limit = 200 } = {}) {
  if (!db) return [];
  const conds = ["t.deleted_at IS NULL"];
  const args = [];
  let join = "";
  if (projectId) { conds.push("t.project_id = ?"); args.push(projectId); }
  if (statusId)  { conds.push("t.status_id = ?"); args.push(statusId); }
  if (assigneeId) { conds.push("t.assignee_id = ?"); args.push(assigneeId); }
  if (parentId === null)  { conds.push("t.parent_id IS NULL"); }
  else if (parentId !== undefined) { conds.push("t.parent_id = ?"); args.push(parentId); }
  if (sprintId) {
    join += " INNER JOIN task_sprint_memberships sm ON sm.task_id = t.id";
    conds.push("sm.sprint_id = ?"); args.push(sprintId);
  }
  if (Array.isArray(labels) && labels.length) {
    const placeholders = labels.map(() => "?").join(", ");
    join += ` INNER JOIN task_labels tl ON tl.task_id = t.id`;
    conds.push(`tl.label IN (${placeholders})`); args.push(...labels);
  }
  if (search) {
    conds.push("(LOWER(t.title) LIKE ? OR LOWER(t.task_key) LIKE ?)");
    args.push(`%${String(search).toLowerCase()}%`, `%${String(search).toLowerCase()}%`);
  }
  args.push(Math.min(Number(limit) || 200, 1000));
  return db.prepare(`
    SELECT DISTINCT t.* FROM tasks t ${join}
    WHERE ${conds.join(" AND ")}
    ORDER BY t.position ASC, t.created_at DESC
    LIMIT ?
  `).all(...args);
}

export function getLabelsForTask(db, taskId) {
  if (!db) return [];
  return db.prepare(`SELECT label FROM task_labels WHERE task_id = ? ORDER BY label`).all(taskId).map((r) => r.label);
}

export function setLabels(db, taskId, labels) {
  if (!db || !taskId) return { ok: false, reason: "missing_args" };
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM task_labels WHERE task_id = ?`).run(taskId);
    if (Array.isArray(labels)) {
      for (const lab of labels) {
        if (lab) db.prepare(`INSERT OR IGNORE INTO task_labels (task_id, label) VALUES (?, ?)`).run(taskId, String(lab).slice(0, 80));
      }
    }
  });
  tx();
  return { ok: true };
}

export function getParticipants(db, taskId) {
  if (!db) return [];
  return db.prepare(`SELECT user_id, role, added_at FROM task_participants WHERE task_id = ? ORDER BY added_at`).all(taskId);
}

export function getDependencies(db, taskId) {
  if (!db) return { blocks: [], blockedBy: [], related: [] };
  const blocks = db.prepare(`
    SELECT d.*, t.task_key, t.title, t.status_id FROM task_dependencies d
    INNER JOIN tasks t ON t.id = d.blocked_id WHERE d.blocker_id = ?
  `).all(taskId);
  const blockedBy = db.prepare(`
    SELECT d.*, t.task_key, t.title, t.status_id FROM task_dependencies d
    INNER JOIN tasks t ON t.id = d.blocker_id WHERE d.blocked_id = ?
  `).all(taskId);
  return { blocks, blockedBy };
}

export function getHistory(db, taskId, { limit = 100 } = {}) {
  if (!db) return [];
  return db.prepare(`
    SELECT id, actor_id, action, field, before_value, after_value, created_at
    FROM task_history WHERE task_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(taskId, limit);
}
