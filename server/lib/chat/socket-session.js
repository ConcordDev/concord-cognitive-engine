// server/lib/chat/socket-session.js
//
// Session load/persist for the socket streaming chat path
// (socket.on("chat:message") in server.js). The HTTP chat.respond macro
// already hydrates from and persists to SQLite (lib/chat-session-store.js);
// the socket path used to keep turns only in STATE.sessions, so any backend
// restart or in-memory eviction made the conversation start from scratch.
//
// Both helpers are best-effort: persistence failures never break chat.

import { hydrateSession, persistChatTurn } from "../chat-session-store.js";
import { assertSessionAccessible } from "../session-access.js";

/**
 * Make sure STATE.sessions has `sessionId`, loading saved history from the
 * chat session store when it isn't in memory, and creating an empty session
 * only when the store doesn't know it either.
 *
 * Returns { ok: true, session, hydrated } or
 *         { ok: false, error: "session_forbidden" } when a signed-in caller
 *         addresses a session owned by somebody else (same rule as the HTTP
 *         chat path: anonymous / ownerless sessions stay permissive).
 */
export function ensureSocketChatSession(db, STATE, sessionId, { ownerId = null, now = () => new Date().toISOString() } = {}) {
  let hydrated = false;
  if (!STATE.sessions.has(sessionId)) {
    try {
      hydrated = hydrateSession(db, STATE, sessionId, { ownerId }) === true;
    } catch { hydrated = false; }
  }
  if (!STATE.sessions.has(sessionId)) {
    STATE.sessions.set(sessionId, {
      ownerId: ownerId || null,
      participantIds: ownerId ? new Set([ownerId]) : new Set(),
      createdAt: now(),
      messages: [],
      currentLens: null,
      lensHistory: [],
      crossDomainContext: {},
    });
  }
  const session = STATE.sessions.get(sessionId);
  if (session?.ownerId && ownerId && !assertSessionAccessible(session, ownerId)) {
    return { ok: false, error: "session_forbidden", hydrated };
  }
  return { ok: true, session, hydrated };
}

/**
 * Persist one completed socket user→assistant turn to SQLite.
 * `userTs` / `assistantTs` may be ISO strings or epoch ms.
 */
export function persistSocketChatTurn(db, sessionId, {
  ownerId = null, lens = null, userText, userTs, assistantText, assistantTs, model = null, source = "ollama-stream",
} = {}) {
  if (!db || !sessionId) return false;
  const toMs = (t, fallback) => {
    if (typeof t === "number" && Number.isFinite(t)) return t;
    const p = Date.parse(t || "");
    return Number.isFinite(p) ? p : fallback;
  };
  const now = Date.now();
  const uTs = toMs(userTs, now);
  let aTs = toMs(assistantTs, now);
  if (aTs <= uTs) aTs = uTs + 1;
  try {
    persistChatTurn(db, sessionId, {
      ownerId,
      lastLens: lens ? String(lens).slice(0, 32) : null,
      userMsg: userText != null ? { role: "user", content: String(userText), ts: uTs } : null,
      assistantMsg: assistantText != null
        ? { role: "assistant", content: String(assistantText), ts: aTs, meta: { llmUsed: true, mode: source } }
        : null,
    });
    return true;
  } catch {
    return false;
  }
}
