// server/lib/horror.js
//
// Phase CC6 — asymmetric horror.
//
// One ghost, many investigators. Ghost wins by downing all
// investigators. Investigators win by collecting enough evidence
// before max_duration_s (default 30 min).

import crypto from "node:crypto";
import logger from "../logger.js";

const DEFAULT_DURATION_S = 30 * 60;
const EVIDENCE_TO_WIN = 3;

export function startSession(db, ghostUserId, opts = {}) {
  if (!db || !ghostUserId) return { ok: false, error: "missing_inputs" };
  const { worldId, maxDurationS = DEFAULT_DURATION_S } = opts;
  if (!worldId) return { ok: false, error: "missing_worldId" };
  try {
    const id = `hor_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO horror_sessions (id, world_id, ghost_user_id, max_duration_s)
      VALUES (?, ?, ?, ?)
    `).run(id, worldId, ghostUserId, Math.max(60, Math.floor(maxDurationS)));
    return { ok: true, sessionId: id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function joinAsInvestigator(db, sessionId, userId) {
  if (!db || !sessionId || !userId) return { ok: false, error: "missing_inputs" };
  try {
    const s = db.prepare(`
      SELECT ghost_user_id, ended_at, investigators_json
      FROM horror_sessions WHERE id = ?
    `).get(sessionId);
    if (!s) return { ok: false, error: "no_session" };
    if (s.ended_at) return { ok: false, error: "session_ended" };
    if (s.ghost_user_id === userId) return { ok: false, error: "ghost_cannot_investigate" };

    const investigators = JSON.parse(s.investigators_json);
    if (investigators.includes(userId)) return { ok: true, alreadyJoined: true };
    investigators.push(userId);
    db.prepare(`
      UPDATE horror_sessions SET investigators_json = ? WHERE id = ?
    `).run(JSON.stringify(investigators), sessionId);
    return { ok: true, investigators };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function recordSighting(db, sessionId, userId, opts = {}) {
  if (!db || !sessionId || !userId) return { ok: false, error: "missing_inputs" };
  const { x, y, z, sightingKind = "blur" } = opts;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") {
    return { ok: false, error: "invalid_coords" };
  }
  try {
    const s = db.prepare(`SELECT ended_at, evidence_collected_json FROM horror_sessions WHERE id = ?`).get(sessionId);
    if (!s) return { ok: false, error: "no_session" };
    if (s.ended_at) return { ok: false, error: "session_ended" };

    const id = `sgt_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO horror_sightings (id, session_id, user_id, x, y, z, sighting_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, userId, x, y, z, sightingKind);

    const evidence = JSON.parse(s.evidence_collected_json);
    if (!evidence.includes(sightingKind)) {
      evidence.push(sightingKind);
      db.prepare(`
        UPDATE horror_sessions SET evidence_collected_json = ? WHERE id = ?
      `).run(JSON.stringify(evidence), sessionId);
    }

    // Auto-win check: enough distinct evidence kinds → investigators win.
    if (evidence.length >= EVIDENCE_TO_WIN) {
      db.prepare(`
        UPDATE horror_sessions
        SET ended_at = unixepoch(), end_reason = 'investigators_won'
        WHERE id = ?
      `).run(sessionId);
      return { ok: true, sightingId: id, evidenceCount: evidence.length, sessionEnded: true, winner: "investigators" };
    }
    return { ok: true, sightingId: id, evidenceCount: evidence.length };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function downInvestigator(db, sessionId, ghostUserId, targetUserId) {
  if (!db || !sessionId || !ghostUserId || !targetUserId) return { ok: false, error: "missing_inputs" };
  try {
    const s = db.prepare(`
      SELECT ghost_user_id, ended_at, investigators_json, downed_investigators_json
      FROM horror_sessions WHERE id = ?
    `).get(sessionId);
    if (!s) return { ok: false, error: "no_session" };
    if (s.ended_at) return { ok: false, error: "session_ended" };
    if (s.ghost_user_id !== ghostUserId) return { ok: false, error: "not_ghost" };

    const investigators = JSON.parse(s.investigators_json);
    if (!investigators.includes(targetUserId)) return { ok: false, error: "not_in_session" };

    const downed = JSON.parse(s.downed_investigators_json);
    if (downed.includes(targetUserId)) return { ok: true, alreadyDowned: true };
    downed.push(targetUserId);
    db.prepare(`
      UPDATE horror_sessions SET downed_investigators_json = ? WHERE id = ?
    `).run(JSON.stringify(downed), sessionId);

    if (investigators.length > 0 && downed.length >= investigators.length) {
      db.prepare(`
        UPDATE horror_sessions
        SET ended_at = unixepoch(), end_reason = 'ghost_won'
        WHERE id = ?
      `).run(sessionId);
      return { ok: true, downed, sessionEnded: true, winner: "ghost" };
    }
    return { ok: true, downed };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function endSession(db, sessionId, opts = {}) {
  if (!db || !sessionId) return { ok: false, error: "missing_inputs" };
  const { reason = "cancelled" } = opts;
  try {
    db.prepare(`
      UPDATE horror_sessions SET ended_at = unixepoch(), end_reason = ?
      WHERE id = ? AND ended_at IS NULL
    `).run(reason, sessionId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function getSession(db, sessionId) {
  if (!db || !sessionId) return null;
  try {
    return db.prepare(`SELECT * FROM horror_sessions WHERE id = ?`).get(sessionId) || null;
  } catch { return null; }
}

/**
 * Find an active session this user is part of (ghost OR investigator).
 */
export function findActiveSessionForUser(db, userId, worldId = null) {
  if (!db || !userId) return null;
  try {
    const rows = db.prepare(`
      SELECT * FROM horror_sessions
      WHERE ended_at IS NULL
      ${worldId ? "AND world_id = ?" : ""}
      ORDER BY started_at DESC LIMIT 50
    `).all(...(worldId ? [worldId] : []));
    for (const r of rows) {
      if (r.ghost_user_id === userId) return { ...r, role: 'ghost' };
      try {
        const investigators = JSON.parse(r.investigators_json || '[]');
        if (Array.isArray(investigators) && investigators.includes(userId)) {
          return { ...r, role: 'investigator' };
        }
      } catch { /* skip */ }
    }
    return null;
  } catch { return null; }
}

export { EVIDENCE_TO_WIN, DEFAULT_DURATION_S };
