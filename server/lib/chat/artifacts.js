// server/lib/chat/artifacts.js
//
// Claude-Artifacts-parity inline live-rendered blocks. Each artifact
// is owned by a chat message; users can edit it, the LLM can edit it
// (autosaves a new version), and either side can revert.

import { randomUUID } from "node:crypto";

const KINDS = new Set(["code","html","svg","markdown","mermaid","react","json","csv","sql","prompt"]);

function _now() { return Math.floor(Date.now() / 1000); }

export function createArtifact(db, { ownerId, sessionId, messageIdx = 0, kind = "code", title = null, language = null, body, authorKind = "llm", note = null }) {
  if (!db || !ownerId || !sessionId || !body) return { ok: false, reason: "missing_args" };
  if (!KINDS.has(kind)) return { ok: false, reason: "invalid_kind" };
  const id = `chart:${randomUUID()}`;
  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO chat_artifacts (id, session_id, message_idx, owner_id, kind, title, language, body, current_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(id, sessionId, Number(messageIdx) || 0, ownerId, kind,
        title ? String(title).slice(0, 200) : null,
        language ? String(language).slice(0, 40) : null,
        String(body).slice(0, 200_000),
        _now(), _now());
      db.prepare(`
        INSERT INTO chat_artifact_versions (artifact_id, version, body, author, author_kind, note, created_at)
        VALUES (?, 1, ?, ?, ?, ?, ?)
      `).run(id, String(body).slice(0, 200_000), ownerId,
        ["user","llm","agent"].includes(authorKind) ? authorKind : "llm",
        note ? String(note).slice(0, 500) : null,
        _now());
    });
    tx();
    return { ok: true, id, version: 1 };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getArtifact(db, id) {
  if (!db || !id) return null;
  return db.prepare(`SELECT * FROM chat_artifacts WHERE id = ?`).get(id);
}

export function listArtifactsForSession(db, sessionId) {
  if (!db || !sessionId) return [];
  return db.prepare(`SELECT * FROM chat_artifacts WHERE session_id = ? ORDER BY message_idx ASC, created_at ASC`).all(sessionId);
}

export function updateArtifactBody(db, id, { body, author, authorKind = "user", note = null }) {
  if (!db || !id || !body || !author) return { ok: false, reason: "missing_args" };
  const cur = db.prepare(`SELECT * FROM chat_artifacts WHERE id = ?`).get(id);
  if (!cur) return { ok: false, reason: "not_found" };
  const nextVersion = cur.current_version + 1;
  try {
    const tx = db.transaction(() => {
      db.prepare(`UPDATE chat_artifacts SET body = ?, current_version = ?, updated_at = ? WHERE id = ?`)
        .run(String(body).slice(0, 200_000), nextVersion, _now(), id);
      db.prepare(`
        INSERT INTO chat_artifact_versions (artifact_id, version, body, author, author_kind, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, nextVersion, String(body).slice(0, 200_000), author,
        ["user","llm","agent"].includes(authorKind) ? authorKind : "user",
        note ? String(note).slice(0, 500) : null,
        _now());
    });
    tx();
    return { ok: true, version: nextVersion };
  } catch (err) {
    return { ok: false, reason: "update_failed", error: err?.message };
  }
}

export function listVersions(db, artifactId, { limit = 50 } = {}) {
  if (!db || !artifactId) return [];
  return db.prepare(`SELECT * FROM chat_artifact_versions WHERE artifact_id = ? ORDER BY version DESC LIMIT ?`).all(artifactId, Math.min(Number(limit), 500));
}

export function revertArtifact(db, artifactId, toVersion, author) {
  if (!db || !artifactId || !toVersion) return { ok: false, reason: "missing_args" };
  const target = db.prepare(`SELECT * FROM chat_artifact_versions WHERE artifact_id = ? AND version = ?`).get(artifactId, toVersion);
  if (!target) return { ok: false, reason: "version_not_found" };
  return updateArtifactBody(db, artifactId, {
    body: target.body, author, authorKind: "user", note: `Reverted to v${toVersion}`,
  });
}

export function deleteArtifact(db, id, userId) {
  if (!db || !id || !userId) return { ok: false, reason: "missing_args" };
  const cur = db.prepare(`SELECT owner_id FROM chat_artifacts WHERE id = ?`).get(id);
  if (!cur) return { ok: false, reason: "not_found" };
  if (cur.owner_id !== userId) return { ok: false, reason: "forbidden" };
  db.prepare(`DELETE FROM chat_artifacts WHERE id = ?`).run(id);
  return { ok: true };
}

// ─── Tool calls audit ────────────────────────────────────────────

export function recordToolCall(db, { sessionId, messageIdx = 0, tool, args = null, result = null, success = true, latencyMs = null, tokens = 0, brainSlot = null }) {
  if (!db || !sessionId || !tool) return { ok: false, reason: "missing_args" };
  const r = db.prepare(`
    INSERT INTO chat_tool_calls (session_id, message_idx, tool, args_json, result_json, success, latency_ms, tokens, brain_slot, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, Number(messageIdx) || 0,
    String(tool).slice(0, 80),
    args ? JSON.stringify(args).slice(0, 4000) : null,
    result ? JSON.stringify(result).slice(0, 4000) : null,
    success ? 1 : 0,
    latencyMs != null ? Number(latencyMs) : null,
    Number(tokens) || 0,
    brainSlot ? String(brainSlot).slice(0, 30) : null,
    _now());
  return { ok: true, id: r.lastInsertRowid };
}

export function listToolCalls(db, sessionId, { messageIdx = null, limit = 200 } = {}) {
  if (!db || !sessionId) return [];
  const sql = messageIdx != null
    ? `SELECT * FROM chat_tool_calls WHERE session_id = ? AND message_idx = ? ORDER BY created_at ASC LIMIT ?`
    : `SELECT * FROM chat_tool_calls WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`;
  const args = messageIdx != null ? [sessionId, Number(messageIdx), Math.min(Number(limit), 1000)] : [sessionId, Math.min(Number(limit), 1000)];
  return db.prepare(sql).all(...args);
}
