/**
 * GET /api/chat/messages.
 *
 * An unknown session is an empty thread, not a 404. The code lens asks for
 * `code-ai-<userId>` on every load, before the first message has created a
 * row. A session that exists and belongs to someone else stays 403.
 */

export function readChatMessages(db, { userId, sessionId, limit = 200 } = {}) {
  if (!userId) return { status: 401, body: { ok: false, error: "auth_required" } };
  const sid = String(sessionId || "").trim();
  if (!sid) return { status: 400, body: { ok: false, error: "missing_sessionId" } };
  if (!db) return { status: 503, body: { ok: false, error: "db_unavailable" } };

  const cap = Math.min(500, Number(limit) || 200);
  let ownerRow;
  try {
    ownerRow = db.prepare(`SELECT owner_id FROM chat_sessions WHERE session_id = ?`).get(sid);
  } catch {
    return { status: 503, body: { ok: false, error: "db_query_failed" } };
  }
  if (!ownerRow) {
    return { status: 200, body: { ok: true, sessionId: sid, messages: [] } };
  }
  if (!ownerRow.owner_id || ownerRow.owner_id !== userId) {
    return { status: 403, body: { ok: false, error: "session_forbidden" } };
  }

  let rows;
  try {
    rows = db.prepare(`
      SELECT role, content, ts, meta_json
      FROM chat_messages
      WHERE session_id = ?
      ORDER BY ts ASC
      LIMIT ?
    `).all(sid, cap);
  } catch {
    return { status: 503, body: { ok: false, error: "db_query_failed" } };
  }

  const messages = (rows || []).map((r) => {
    let meta = null;
    try { meta = r.meta_json ? JSON.parse(r.meta_json) : null; } catch { /* corrupt meta — drop */ }
    return {
      role: r.role,
      content: r.content,
      ts: new Date(r.ts).toISOString(),
      meta: meta || undefined,
    };
  });
  return { status: 200, body: { ok: true, sessionId: sid, messages } };
}
