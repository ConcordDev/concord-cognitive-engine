// server/lib/chat-session-store.js
//
// SQLite-backed persistence for chat sessions + messages. Sits next to
// STATE.sessions (in-memory) — STATE.sessions stays the hot read path
// for the chat handler; this module persists the same data so a server
// restart doesn't wipe multi-turn context.
//
// All functions are best-effort: if `db` is missing or a query fails,
// they log and return without throwing. The chat path MUST NEVER fail
// because persistence failed.
//
// Wire-up in server.js chat respond macro:
//   - At the end of chat.respond, call `persistChatTurn(db, sessionId, ...)`
//     with the user msg + assistant msg.
//   - Before reading STATE.sessions.get(sessionId), call
//     `hydrateSession(db, STATE, sessionId, ownerId)` which fills the
//     in-memory map from the last N persisted messages if absent.
//
// Schema lives in migrations/193_chat_sessions.js.

import logger from "../logger.js";

const HYDRATE_LIMIT = 60;        // matches STATE.sessions splice cap
const TITLE_MAX_LEN = 80;

function _now() { return Date.now(); }

function _serialiseMeta(meta) {
  if (!meta) return null;
  try {
    // Strip any heavy/unserialisable fields. toolCalls + computed +
    // dtuRefs + sources are the only fields the surface re-renders
    // from; everything else is router/log debris.
    const slim = {
      llmUsed: meta.llmUsed,
      mode: meta.mode,
      toolCalls: meta.toolCalls,
      toolCallCount: meta.toolCallCount,
      computed: meta.computed,
      dtuRefs: meta.dtuRefs,
      sources: meta.sources,
      webAugmented: meta.webAugmented,
    };
    return JSON.stringify(slim);
  } catch {
    return null;
  }
}

function _parseMeta(metaJson) {
  if (!metaJson) return null;
  try { return JSON.parse(metaJson); } catch { return null; }
}

/**
 * Ensure a chat_sessions row exists; bump updated_at + msg_count when
 * persisting a new turn. Idempotent — uses INSERT OR IGNORE then UPDATE.
 */
export function upsertSession(db, sessionId, { ownerId = null, title = null, lastLens = null } = {}) {
  if (!db || !sessionId) return;
  try {
    const now = _now();
    db.prepare(`
      INSERT OR IGNORE INTO chat_sessions
        (session_id, owner_id, title, last_lens, created_at, updated_at, msg_count)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(sessionId, ownerId, title, lastLens, now, now);
    if (lastLens) {
      db.prepare(`UPDATE chat_sessions SET last_lens = ?, updated_at = ? WHERE session_id = ?`)
        .run(lastLens, now, sessionId);
    }
  } catch (err) {
    logger.debug?.("chat-session-store", "upsertSession_failed", { sessionId, error: err?.message });
  }
}

/**
 * Persist a single turn (user msg + assistant msg are two calls).
 * Bumps the session's updated_at + msg_count.
 */
export function persistChatMessage(db, sessionId, { role, content, ts = _now(), meta = null } = {}) {
  if (!db || !sessionId || !role || content == null) return;
  try {
    db.prepare(`
      INSERT INTO chat_messages (session_id, role, content, ts, meta_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, role, String(content).slice(0, 65535), ts, _serialiseMeta(meta));
    db.prepare(`
      UPDATE chat_sessions
      SET updated_at = ?, msg_count = msg_count + 1
      WHERE session_id = ?
    `).run(ts, sessionId);
  } catch (err) {
    logger.debug?.("chat-session-store", "persistChatMessage_failed", { sessionId, error: err?.message });
  }
}

/**
 * Convenience: persist a complete user→assistant turn in a single tx,
 * also auto-titling the session from the first user message.
 */
export function persistChatTurn(db, sessionId, { ownerId, lastLens, userMsg, assistantMsg } = {}) {
  if (!db || !sessionId) return;
  try {
    const now = _now();
    upsertSession(db, sessionId, { ownerId, lastLens });

    // Auto-title from the first user message if title is still null.
    try {
      const cur = db.prepare(`SELECT title, msg_count FROM chat_sessions WHERE session_id = ?`).get(sessionId);
      if (cur && (!cur.title || cur.msg_count === 0) && userMsg?.content) {
        const seed = String(userMsg.content).replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_LEN);
        if (seed) {
          db.prepare(`UPDATE chat_sessions SET title = ? WHERE session_id = ? AND (title IS NULL OR title = '')`)
            .run(seed, sessionId);
        }
      }
    } catch { /* non-fatal */ }

    if (userMsg) persistChatMessage(db, sessionId, { ...userMsg, ts: userMsg.ts || now });
    if (assistantMsg) persistChatMessage(db, sessionId, { ...assistantMsg, ts: assistantMsg.ts || (now + 1) });
  } catch (err) {
    logger.debug?.("chat-session-store", "persistChatTurn_failed", { sessionId, error: err?.message });
  }
}

/**
 * If STATE.sessions doesn't have this sessionId yet, fill it from the
 * persisted store. Returns true if hydration actually fetched rows.
 *
 * Called at the top of chat.respond, BEFORE the STATE.sessions.has check.
 * This is what makes "open chat next morning, send a follow-up to
 * yesterday's conversation, brain still has context" actually work.
 */
export function hydrateSession(db, STATE, sessionId, { ownerId = null } = {}) {
  if (!db || !STATE || !sessionId) return false;
  if (STATE.sessions?.has?.(sessionId)) return false;
  try {
    const sess = db.prepare(`SELECT owner_id, last_lens, created_at FROM chat_sessions WHERE session_id = ?`)
      .get(sessionId);
    if (!sess) return false;
    const rows = db.prepare(`
      SELECT role, content, ts, meta_json
      FROM chat_messages
      WHERE session_id = ?
      ORDER BY ts ASC
      LIMIT ?
    `).all(sessionId, HYDRATE_LIMIT);
    if (!rows || rows.length === 0) {
      // Session row exists but no messages — still seed the in-mem
      // entry so the chat handler doesn't recreate it with a wrong owner.
      STATE.sessions.set(sessionId, {
        ownerId: sess.owner_id || ownerId,
        participantIds: sess.owner_id ? new Set([sess.owner_id]) : new Set(),
        createdAt: new Date(sess.created_at).toISOString(),
        messages: [],
        currentLens: sess.last_lens || null,
        lensHistory: sess.last_lens ? [{ lens: sess.last_lens, enteredAt: new Date(sess.created_at).toISOString() }] : [],
        crossDomainContext: {},
      });
      return false;
    }
    STATE.sessions.set(sessionId, {
      ownerId: sess.owner_id || ownerId,
      participantIds: sess.owner_id ? new Set([sess.owner_id]) : new Set(),
      createdAt: new Date(sess.created_at).toISOString(),
      messages: rows.map(r => ({
        role: r.role,
        content: r.content,
        ts: new Date(r.ts).toISOString(),
        meta: _parseMeta(r.meta_json) || undefined,
      })),
      currentLens: sess.last_lens || null,
      lensHistory: sess.last_lens ? [{ lens: sess.last_lens, enteredAt: new Date(sess.created_at).toISOString() }] : [],
      crossDomainContext: {},
    });
    return true;
  } catch (err) {
    logger.debug?.("chat-session-store", "hydrateSession_failed", { sessionId, error: err?.message });
    return false;
  }
}

/**
 * List recent sessions for a user (sidebar payload).
 */
export function listRecentSessions(db, ownerId, { limit = 50 } = {}) {
  if (!db || !ownerId) return [];
  try {
    return db.prepare(`
      SELECT session_id AS id, title, last_lens AS lens, created_at, updated_at, msg_count
      FROM chat_sessions
      WHERE owner_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(ownerId, Math.min(200, limit));
  } catch (err) {
    logger.debug?.("chat-session-store", "listRecentSessions_failed", { ownerId, error: err?.message });
    return [];
  }
}

export const CHAT_SESSION_STORE_DEFAULTS = Object.freeze({
  HYDRATE_LIMIT,
  TITLE_MAX_LEN,
});
