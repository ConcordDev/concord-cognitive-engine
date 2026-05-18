// server/lib/whiteboard/persistence.js
//
// Whiteboard Sprint A #1 — DB persistence layer.
//
// Wraps migration 208 tables (whiteboard_boards, whiteboard_scene_deltas,
// whiteboard_participants, whiteboard_comments, whiteboard_images) with
// a small set of helpers used by domains/whiteboard.js + domains/
// whiteboard-comments.js + domains/whiteboard-mint.js.
//
// All helpers are write-safe (catch + return ok envelopes) and use real
// prepared statements. No mocks; the STATE Map in whiteboard.js stays
// the hot cache, but the source of truth is now SQLite.

import { randomUUID } from "node:crypto";

const SCENE_PREVIEW_MAX = 1_000_000;          // 1MB cap on scene JSON we persist

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fallback) {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

/**
 * Upsert a board row (private or shared) and ensure the owner is
 * registered as a participant with role='owner'. Returns the row.
 */
export function upsertBoard(db, { id, ownerId, title, kind = "private", scene, meta }) {
  if (!db || !ownerId) return { ok: false, reason: "missing_db_or_owner" };
  const boardId = id || `wb_${randomUUID()}`;
  const sceneJson = scene ? JSON.stringify(scene).slice(0, SCENE_PREVIEW_MAX) : null;
  const metaJson = meta ? JSON.stringify(meta) : null;
  try {
    db.prepare(`
      INSERT INTO whiteboard_boards (id, owner_id, title, kind, scene_json, meta_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        scene_json = COALESCE(excluded.scene_json, whiteboard_boards.scene_json),
        meta_json = COALESCE(excluded.meta_json, whiteboard_boards.meta_json),
        updated_at = excluded.updated_at
    `).run(boardId, ownerId, String(title || "Untitled board").slice(0, 200), kind, sceneJson, metaJson, _now(), _now());
    // Owner is always a participant.
    db.prepare(`
      INSERT INTO whiteboard_participants (board_id, user_id, role, invited_by, invited_at)
      VALUES (?, ?, 'owner', ?, ?)
      ON CONFLICT(board_id, user_id) DO UPDATE SET role = 'owner'
    `).run(boardId, ownerId, ownerId, _now());
    return { ok: true, id: boardId, row: getBoard(db, boardId) };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getBoard(db, id) {
  if (!db) return null;
  const row = db.prepare(`SELECT * FROM whiteboard_boards WHERE id = ?`).get(id);
  if (!row) return null;
  return { ...row, scene: _safeJson(row.scene_json, { elements: [], appState: {} }), meta: _safeJson(row.meta_json, {}) };
}

export function listBoardsForOwner(db, ownerId, { kind, limit = 100, offset = 0 } = {}) {
  if (!db || !ownerId) return [];
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);
  const sql = kind
    ? `SELECT id, owner_id, title, kind, created_at, updated_at FROM whiteboard_boards WHERE owner_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    : `SELECT id, owner_id, title, kind, created_at, updated_at FROM whiteboard_boards WHERE owner_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
  return kind ? db.prepare(sql).all(ownerId, kind, lim, off) : db.prepare(sql).all(ownerId, lim, off);
}

export function listBoardsForParticipant(db, userId, { limit = 100 } = {}) {
  if (!db || !userId) return [];
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  return db.prepare(`
    SELECT b.id, b.owner_id, b.title, b.kind, b.created_at, b.updated_at, p.role
    FROM whiteboard_boards b
    JOIN whiteboard_participants p ON p.board_id = b.id
    WHERE p.user_id = ?
    ORDER BY b.updated_at DESC
    LIMIT ?
  `).all(userId, lim);
}

export function deleteBoard(db, id, ownerId) {
  if (!db) return { ok: false, reason: "no_db" };
  const r = db.prepare(`DELETE FROM whiteboard_boards WHERE id = ? AND owner_id = ?`).run(id, ownerId);
  return { ok: true, deleted: r.changes };
}

/**
 * Append a delta to whiteboard_scene_deltas. Also updates the
 * board's `scene_json` snapshot when delta_kind = 'scene_replace'
 * or 'snapshot' or 'restore'.
 */
export function appendDelta(db, { boardId, userId, deltaKind, delta, clientTs, newScene }) {
  if (!db || !boardId || !userId) return { ok: false, reason: "missing_args" };
  if (!deltaKind || typeof delta !== "object") return { ok: false, reason: "missing_kind_or_delta" };
  try {
    db.prepare(`
      INSERT INTO whiteboard_scene_deltas (board_id, user_id, delta_kind, delta_json, server_ts, client_ts)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(boardId, userId, deltaKind, JSON.stringify(delta).slice(0, SCENE_PREVIEW_MAX), _now(), clientTs ? Number(clientTs) : null);
    if (newScene && (deltaKind === "scene_replace" || deltaKind === "snapshot" || deltaKind === "restore")) {
      db.prepare(`UPDATE whiteboard_boards SET scene_json = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(newScene).slice(0, SCENE_PREVIEW_MAX), _now(), boardId);
    } else {
      db.prepare(`UPDATE whiteboard_boards SET updated_at = ? WHERE id = ?`).run(_now(), boardId);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function listDeltas(db, { boardId, since = 0, limit = 500 } = {}) {
  if (!db || !boardId) return [];
  const lim = Math.min(2000, Math.max(1, Number(limit) || 500));
  return db.prepare(`
    SELECT id, user_id, delta_kind, delta_json, server_ts, client_ts
    FROM whiteboard_scene_deltas
    WHERE board_id = ? AND server_ts > ?
    ORDER BY server_ts ASC, id ASC
    LIMIT ?
  `).all(boardId, Number(since) || 0, lim).map((r) => ({ ...r, delta: _safeJson(r.delta_json, {}) }));
}

/**
 * Participants + roles. Owner can do anything; admin can invite/revoke
 * but not transfer ownership; editor can change scene + comment; commenter
 * can only comment; viewer is read-only.
 */
const ROLE_RANK = { owner: 5, admin: 4, editor: 3, commenter: 2, viewer: 1 };

export function getRole(db, boardId, userId) {
  if (!db || !boardId || !userId) return null;
  const row = db.prepare(`SELECT role FROM whiteboard_participants WHERE board_id = ? AND user_id = ?`).get(boardId, userId);
  return row?.role || null;
}

export function hasRole(db, boardId, userId, minRole) {
  const r = getRole(db, boardId, userId);
  if (!r) return false;
  return (ROLE_RANK[r] || 0) >= (ROLE_RANK[minRole] || 0);
}

export function inviteParticipant(db, { boardId, userId, role = "editor", invitedBy }) {
  if (!db || !boardId || !userId) return { ok: false, reason: "missing_args" };
  if (!ROLE_RANK[role]) return { ok: false, reason: "invalid_role" };
  try {
    db.prepare(`
      INSERT INTO whiteboard_participants (board_id, user_id, role, invited_by, invited_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(board_id, user_id) DO UPDATE SET role = excluded.role
    `).run(boardId, userId, role, invitedBy || null, _now());
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function revokeParticipant(db, { boardId, userId }) {
  if (!db) return { ok: false, reason: "no_db" };
  const r = db.prepare(`DELETE FROM whiteboard_participants WHERE board_id = ? AND user_id = ? AND role != 'owner'`).run(boardId, userId);
  return { ok: true, revoked: r.changes };
}

export function listParticipants(db, boardId) {
  if (!db) return [];
  return db.prepare(`SELECT user_id, role, invited_at FROM whiteboard_participants WHERE board_id = ? ORDER BY invited_at ASC`).all(boardId);
}
