// server/lib/spectator.js
//
// Phase 9.2 (idea #9) — Live-streamable Concordia.
//
// Read-only viewer attachment to a world. Spectator gets a session
// token + WS endpoint and receives realtime emit events filtered by
// world. Cannot intervene (combat:attack et al. gated by observer
// role check upstream).

import crypto from "node:crypto";

const SESSION_TIMEOUT_S = 600; // 10 min idle → drop

export function startSession(db, worldId, viewerUserId = null) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  const token = crypto.randomBytes(16).toString("hex");
  try {
    db.prepare(`
      INSERT INTO spectator_sessions (world_id, session_token, viewer_user_id)
      VALUES (?, ?, ?)
    `).run(worldId, token, viewerUserId);
    return { ok: true, sessionToken: token, worldId, wsHint: `/ws/spectate/${worldId}?t=${token}` };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}

export function heartbeatSession(db, sessionToken) {
  if (!db || !sessionToken) return { ok: false, reason: "missing_token" };
  try {
    const r = db.prepare(`
      UPDATE spectator_sessions SET last_seen_at = unixepoch()
      WHERE session_token = ?
    `).run(sessionToken);
    return { ok: r.changes > 0, refreshed: r.changes > 0 };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}

export function activeSpectators(db, worldId) {
  if (!db || !worldId) return [];
  try {
    const cutoff = Math.floor(Date.now() / 1000) - SESSION_TIMEOUT_S;
    return db.prepare(`
      SELECT id, session_token, viewer_user_id, started_at, last_seen_at
      FROM spectator_sessions WHERE world_id = ? AND last_seen_at >= ?
      ORDER BY started_at ASC
    `).all(worldId, cutoff);
  } catch { return []; }
}

export function sweepStaleSessions(db) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const cutoff = Math.floor(Date.now() / 1000) - SESSION_TIMEOUT_S;
    const r = db.prepare(`DELETE FROM spectator_sessions WHERE last_seen_at < ?`).run(cutoff);
    return { ok: true, removed: r.changes };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}
