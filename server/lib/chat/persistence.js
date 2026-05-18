// server/lib/chat/persistence.js
//
// Chat Sprint A — DB persistence for memory + projects + personas +
// prompts + scheduled tasks + branches (migration 223).

import { randomUUID } from "node:crypto";

const ROLE_RANK = { owner: 5, admin: 4, member: 3, viewer: 1 };

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

// ─── Memory ───────────────────────────────────────────────────────

const MEM_KINDS = new Set(["preference","identity","goal","context","constraint","fact"]);

export function saveMemory(db, { userId, projectId = null, fact, kind = "preference", sessionId = null, confidence = 0.7 }) {
  if (!db || !userId || !fact) return { ok: false, reason: "missing_args" };
  const k = MEM_KINDS.has(kind) ? kind : "preference";
  const r = db.prepare(`
    INSERT INTO chat_user_memory (user_id, project_id, fact, kind, source_session_id, confidence, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(userId, projectId, String(fact).slice(0, 800), k, sessionId,
    Math.max(0, Math.min(1, Number(confidence))), _now(), _now());
  return { ok: true, id: r.lastInsertRowid };
}

export function recallMemory(db, { userId, projectId = null, limit = 25 }) {
  if (!db || !userId) return [];
  // Project memory first, then global; rank by updated_at + confidence
  const rows = db.prepare(`
    SELECT * FROM chat_user_memory
    WHERE user_id = ? AND enabled = 1
      AND (project_id IS NULL OR project_id = ?)
    ORDER BY (project_id IS NOT NULL) DESC, confidence DESC, updated_at DESC
    LIMIT ?
  `).all(userId, projectId, Math.min(Number(limit) || 25, 200));
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(", ");
    db.prepare(`UPDATE chat_user_memory SET hit_count = hit_count + 1 WHERE id IN (${placeholders})`).run(...ids);
  }
  return rows;
}

export function listMemory(db, userId, { projectId = null, includeDisabled = false, limit = 200 } = {}) {
  if (!db || !userId) return [];
  const sql = projectId
    ? `SELECT * FROM chat_user_memory WHERE user_id = ? AND project_id = ? ${includeDisabled ? "" : "AND enabled = 1"} ORDER BY updated_at DESC LIMIT ?`
    : `SELECT * FROM chat_user_memory WHERE user_id = ? ${includeDisabled ? "" : "AND enabled = 1"} ORDER BY updated_at DESC LIMIT ?`;
  const args = projectId ? [userId, projectId, Math.min(Number(limit), 500)] : [userId, Math.min(Number(limit), 500)];
  return db.prepare(sql).all(...args);
}

export function updateMemory(db, id, userId, patch) {
  if (!db || !id || !userId) return { ok: false, reason: "missing_args" };
  const updates = [];
  const args = [];
  if (patch.fact !== undefined) { updates.push("fact = ?"); args.push(String(patch.fact).slice(0, 800)); }
  if (patch.kind !== undefined && MEM_KINDS.has(patch.kind)) { updates.push("kind = ?"); args.push(patch.kind); }
  if (patch.enabled !== undefined) { updates.push("enabled = ?"); args.push(patch.enabled ? 1 : 0); }
  if (patch.confidence !== undefined) { updates.push("confidence = ?"); args.push(Math.max(0, Math.min(1, Number(patch.confidence)))); }
  if (updates.length === 0) return { ok: false, reason: "nothing_to_update" };
  updates.push("updated_at = ?"); args.push(_now());
  args.push(id, userId);
  const r = db.prepare(`UPDATE chat_user_memory SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`).run(...args);
  return { ok: r.changes > 0 };
}

export function deleteMemory(db, id, userId) {
  if (!db || !id || !userId) return { ok: false, reason: "missing_args" };
  const r = db.prepare(`DELETE FROM chat_user_memory WHERE id = ? AND user_id = ?`).run(id, userId);
  return { ok: r.changes > 0 };
}

// ─── Projects ─────────────────────────────────────────────────────

export function createProject(db, { ownerId, name, description = null, icon = null, color = null, systemPrompt = null, brainPreference = null, temperature = null, visibility = "private" }) {
  if (!db || !ownerId || !name) return { ok: false, reason: "missing_args" };
  const id = `chproj:${randomUUID()}`;
  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO chat_projects (id, owner_id, name, description, icon, color, system_prompt, brain_preference, temperature, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ownerId,
        String(name).slice(0, 120),
        description ? String(description).slice(0, 2000) : null,
        icon, color || "#22d3ee",
        systemPrompt ? String(systemPrompt).slice(0, 8000) : null,
        brainPreference, temperature,
        visibility, _now(), _now());
      db.prepare(`INSERT INTO chat_project_members (project_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)`).run(id, ownerId, _now());
    });
    tx();
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getProject(db, id) {
  if (!db || !id) return null;
  const row = db.prepare(`SELECT * FROM chat_projects WHERE id = ? AND archived_at IS NULL`).get(id);
  return row || null;
}

export function listProjectsForUser(db, userId, { limit = 100 } = {}) {
  if (!db || !userId) return [];
  return db.prepare(`
    SELECT p.* FROM chat_projects p
    INNER JOIN chat_project_members m ON m.project_id = p.id
    WHERE m.user_id = ? AND p.archived_at IS NULL
    ORDER BY p.updated_at DESC LIMIT ?
  `).all(userId, Math.min(Number(limit), 500));
}

export function getProjectRole(db, projectId, userId) {
  if (!db || !projectId || !userId) return null;
  const row = db.prepare(`SELECT role FROM chat_project_members WHERE project_id = ? AND user_id = ?`).get(projectId, userId);
  if (row) return row.role;
  const p = db.prepare(`SELECT visibility FROM chat_projects WHERE id = ?`).get(projectId);
  if (p?.visibility === "public" || p?.visibility === "workspace") return "viewer";
  return null;
}

export function hasProjectRole(db, projectId, userId, min) {
  const r = getProjectRole(db, projectId, userId);
  if (!r) return false;
  return (ROLE_RANK[r] || 0) >= (ROLE_RANK[min] || 0);
}

export function updateProject(db, id, patch = {}) {
  const updates = [];
  const args = [];
  if (patch.name !== undefined) { updates.push("name = ?"); args.push(String(patch.name).slice(0, 120)); }
  if (patch.description !== undefined) { updates.push("description = ?"); args.push(patch.description ? String(patch.description).slice(0, 2000) : null); }
  if (patch.icon !== undefined) { updates.push("icon = ?"); args.push(patch.icon); }
  if (patch.color !== undefined) { updates.push("color = ?"); args.push(patch.color); }
  if (patch.systemPrompt !== undefined) { updates.push("system_prompt = ?"); args.push(patch.systemPrompt ? String(patch.systemPrompt).slice(0, 8000) : null); }
  if (patch.brainPreference !== undefined) { updates.push("brain_preference = ?"); args.push(patch.brainPreference); }
  if (patch.temperature !== undefined) { updates.push("temperature = ?"); args.push(patch.temperature != null ? Number(patch.temperature) : null); }
  if (patch.visibility !== undefined && ["private","team","workspace","public"].includes(patch.visibility)) {
    updates.push("visibility = ?"); args.push(patch.visibility);
  }
  if (updates.length === 0) return { ok: false, reason: "nothing_to_update" };
  updates.push("updated_at = ?"); args.push(_now());
  args.push(id);
  const r = db.prepare(`UPDATE chat_projects SET ${updates.join(", ")} WHERE id = ?`).run(...args);
  return { ok: r.changes > 0 };
}

export function archiveProject(db, id, userId) {
  if (!hasProjectRole(db, id, userId, "owner")) return { ok: false, reason: "forbidden" };
  const r = db.prepare(`UPDATE chat_projects SET archived_at = ? WHERE id = ?`).run(_now(), id);
  return { ok: r.changes > 0 };
}

export function attachDtuToProject(db, projectId, dtuId, userId) {
  if (!db || !projectId || !dtuId) return { ok: false, reason: "missing_args" };
  if (!hasProjectRole(db, projectId, userId, "member")) return { ok: false, reason: "forbidden" };
  db.prepare(`INSERT OR IGNORE INTO chat_project_attached_dtus (project_id, dtu_id, attached_by, attached_at) VALUES (?, ?, ?, ?)`)
    .run(projectId, dtuId, userId, _now());
  return { ok: true };
}

export function listProjectDtus(db, projectId) {
  if (!db || !projectId) return [];
  return db.prepare(`SELECT * FROM chat_project_attached_dtus WHERE project_id = ? ORDER BY attached_at DESC`).all(projectId);
}

export function detachDtuFromProject(db, projectId, dtuId, userId) {
  if (!hasProjectRole(db, projectId, userId, "member")) return { ok: false, reason: "forbidden" };
  const r = db.prepare(`DELETE FROM chat_project_attached_dtus WHERE project_id = ? AND dtu_id = ?`).run(projectId, dtuId);
  return { ok: r.changes > 0 };
}

// ─── Personas ─────────────────────────────────────────────────────

const PERSONA_BRAINS = new Set(["conscious","subconscious","utility","repair","multimodal"]);

export function createPersona(db, { ownerId, name, description = null, icon = null, systemPrompt, brainSlot = "conscious", styleVector = null, toolAllowlist = null, visibility = "private" }) {
  if (!db || !ownerId || !name || !systemPrompt) return { ok: false, reason: "missing_args" };
  const id = `persona:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO chat_personas (id, owner_id, name, description, icon, system_prompt, brain_slot, style_vector_json, tool_allowlist_json, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ownerId,
      String(name).slice(0, 120),
      description ? String(description).slice(0, 600) : null,
      icon,
      String(systemPrompt).slice(0, 8000),
      PERSONA_BRAINS.has(brainSlot) ? brainSlot : "conscious",
      styleVector ? JSON.stringify(styleVector) : null,
      toolAllowlist ? JSON.stringify(toolAllowlist) : null,
      ["private","workspace","public"].includes(visibility) ? visibility : "private",
      _now(), _now());
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getPersona(db, id) {
  if (!db || !id) return null;
  const row = db.prepare(`SELECT * FROM chat_personas WHERE id = ?`).get(id);
  return row ? { ...row, style_vector: _safeJson(row.style_vector_json, null), tool_allowlist: _safeJson(row.tool_allowlist_json, null) } : null;
}

export function listPersonas(db, userId, { limit = 100 } = {}) {
  if (!db || !userId) return [];
  return db.prepare(`
    SELECT * FROM chat_personas
    WHERE owner_id = ? OR visibility IN ('workspace','public')
    ORDER BY (owner_id = ?) DESC, usage_count DESC, updated_at DESC LIMIT ?
  `).all(userId, userId, Math.min(Number(limit), 500));
}

export function bumpPersonaUsage(db, id) {
  if (!db || !id) return;
  db.prepare(`UPDATE chat_personas SET usage_count = usage_count + 1 WHERE id = ?`).run(id);
}

export function deletePersona(db, id, userId) {
  const r = db.prepare(`DELETE FROM chat_personas WHERE id = ? AND owner_id = ?`).run(id, userId);
  return { ok: r.changes > 0 };
}

// ─── Prompts library ──────────────────────────────────────────────

export function createPrompt(db, { ownerId, title, body, category = null, tags = null, visibility = "private" }) {
  if (!db || !ownerId || !title || !body) return { ok: false, reason: "missing_args" };
  const id = `chprompt:${randomUUID()}`;
  db.prepare(`
    INSERT INTO chat_prompts (id, owner_id, title, body, category, tags_json, visibility, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ownerId,
    String(title).slice(0, 200),
    String(body).slice(0, 8000),
    category, tags ? JSON.stringify(tags) : null,
    ["private","workspace","public"].includes(visibility) ? visibility : "private",
    _now(), _now());
  return { ok: true, id };
}

export function listPrompts(db, userId, { category = null, limit = 100 } = {}) {
  if (!db || !userId) return [];
  const sql = category
    ? `SELECT * FROM chat_prompts WHERE (owner_id = ? OR visibility IN ('workspace','public')) AND category = ? ORDER BY usage_count DESC, updated_at DESC LIMIT ?`
    : `SELECT * FROM chat_prompts WHERE owner_id = ? OR visibility IN ('workspace','public') ORDER BY (owner_id = ?) DESC, usage_count DESC LIMIT ?`;
  const args = category ? [userId, category, Math.min(Number(limit), 500)] : [userId, userId, Math.min(Number(limit), 500)];
  return db.prepare(sql).all(...args);
}

export function deletePrompt(db, id, userId) {
  const r = db.prepare(`DELETE FROM chat_prompts WHERE id = ? AND owner_id = ?`).run(id, userId);
  return { ok: r.changes > 0 };
}

export function bumpPromptUsage(db, id) {
  if (!db || !id) return;
  db.prepare(`UPDATE chat_prompts SET usage_count = usage_count + 1 WHERE id = ?`).run(id);
}

// ─── Branches ─────────────────────────────────────────────────────

export function recordBranch(db, { sessionId, parentMessageIdx, branchedSessionId, branchedBy, reason = null }) {
  if (!db || !sessionId || !branchedSessionId || !branchedBy) return { ok: false, reason: "missing_args" };
  const id = `chbr:${randomUUID()}`;
  db.prepare(`
    INSERT INTO chat_message_branches (id, session_id, parent_message_idx, branched_session_id, branched_by, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, Number(parentMessageIdx) || 0, branchedSessionId, branchedBy, reason, _now());
  return { ok: true, id };
}

export function listBranches(db, sessionId) {
  if (!db || !sessionId) return [];
  return db.prepare(`SELECT * FROM chat_message_branches WHERE session_id = ? OR branched_session_id = ? ORDER BY created_at`).all(sessionId, sessionId);
}
