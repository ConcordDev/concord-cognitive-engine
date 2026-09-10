/**
 * Concord ATS — Store
 * Session-level affective state storage with ring buffer event log.
 */

import { createState, createMomentum, resetState as engineReset } from "./engine.js";
import { EVENT_LOG_SIZE } from "./defaults.js";

/** @type {Map<string, { E: object, M: object, events: object[], lastAccess: number }>} */
const sessions = new Map();
const MAX_SESSIONS = 10000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Evict stale sessions when the map exceeds MAX_SESSIONS.
 */
function _evictStaleSessions() {
  if (sessions.size <= MAX_SESSIONS) return;
  const now = Date.now();
  // First pass: remove expired sessions
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL_MS) sessions.delete(id);
  }
  // Second pass: if still over cap, remove oldest
  if (sessions.size > MAX_SESSIONS) {
    const sorted = [...sessions.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const toRemove = sorted.slice(0, sessions.size - MAX_SESSIONS);
    for (const [id] of toRemove) sessions.delete(id);
  }
}

/**
 * Get or create the affective state for a session.
 * 2026-08-31: dual-read from affect_state on first creation (post-restart hydration)
 * @param {string} sessionId
 * @returns {{ E: object, M: object, events: object[] }}
 */
export function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    _evictStaleSessions();
    const fresh = {
      E: createState(),
      M: createMomentum(),
      events: [],
      lastAccess: Date.now(),
    };
    // Try to hydrate from DB
    try {
      const db = globalThis?._concordDB;
      if (db) {
        const entity_id = String(sessionId).replace(/_session$/, "");
        const row = db.prepare("SELECT * FROM affect_state WHERE entity_id = ? ORDER BY updated_at DESC LIMIT 1").get(entity_id);
        if (row) {
          fresh.E = {
            v: row.v, a: row.a, s: row.s, c: row.c, g: row.g, t: row.t, f: row.f,
            ts: row.updated_at || Date.now(),
            meta: row.meta_json ? safeJsonParse(row.meta_json, {}) : {},
          };
          fresh.M = {
            m_v: row.m_v || 0, m_a: row.m_a || 0, m_s: row.m_s || 0,
            m_c: row.m_c || 0, m_g: row.m_g || 0, m_t: row.m_t || 0, m_f: row.m_f || 0,
          };
          // Hydrate recent events from DB
          const events = db.prepare("SELECT * FROM affect_events_log WHERE entity_id = ? ORDER BY occurred_at DESC LIMIT 50").all(entity_id);
          fresh.events = events.reverse().map(e => ({
            type: e.event_type,
            intensity: e.magnitude,
            polarity: 0,
            delta: e.delta_json ? safeJsonParse(e.delta_json, {}) : {},
            source: e.source || "ats",
            ref_id: e.ref_id,
            ts: e.occurred_at,
            id: e.id,
          }));
        }
      }
    } catch { /* silent — table may not exist yet */ }
    sessions.set(sessionId, fresh);
  }
  const session = sessions.get(sessionId);
  session.lastAccess = Date.now();
  return session;
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * Get the affective state for a session (read-only copy).
 * Returns null if session doesn't exist.
 */
export function getState(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return { ...session.E };
}

/**
 * Log an event to the session's ring buffer.
 * 2026-08-31: dual-write to affect_events_log + affect_state for persistence
 */
export function logEvent(sessionId, event) {
  const session = getSession(sessionId);
  const eventWithMeta = {
    ...event,
    ts: event.ts || Date.now(),
    id: event.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
  session.events.push(eventWithMeta);

  // Ring buffer: trim to max size
  if (session.events.length > EVENT_LOG_SIZE) {
    session.events = session.events.slice(-EVENT_LOG_SIZE);
  }

  // 2026-08-31: Dual-write to persistent DB
  // sessionId may be "<entityId>_session" — strip suffix for entity_id column
  try {
    const db = globalThis?._concordDB;
    if (db) {
      const entity_id = String(sessionId).replace(/_session$/, "");
      const world_id = "concordia-hub";
      const magnitude = event.intensity ?? event.magnitude ?? 0;
      const delta_json = JSON.stringify(event.delta || event.payload || {});
      const source = (event.source && typeof event.source === "object") ? (event.source.name || "ats") : (event.source || "ats");
      db.prepare(`INSERT OR REPLACE INTO affect_events_log
        (id, entity_id, world_id, event_type, delta_json, magnitude, source, ref_id, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          eventWithMeta.id, entity_id, world_id, event.type || "CUSTOM",
          delta_json, magnitude, source, event.ref_id || null, eventWithMeta.ts
      );
      // Also write current state to affect_state
      const E = session.E;
      const M = session.M || {};
      db.prepare(`INSERT OR REPLACE INTO affect_state
        (entity_id, world_id, v, a, s, c, g, t, f, m_v, m_a, m_s, m_c, m_g, m_t, m_f, meta_json, last_tick_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          entity_id, world_id,
          E.v ?? 0, E.a ?? 0.5, E.s ?? 0.5, E.c ?? 0.5, E.g ?? 0.5, E.t ?? 0, E.f ?? 0,
          M.m_v ?? 0, M.m_a ?? 0, M.m_s ?? 0, M.m_c ?? 0, M.m_g ?? 0, M.m_t ?? 0, M.m_f ?? 0,
          JSON.stringify(E.meta || {}), eventWithMeta.ts, eventWithMeta.ts
      );
    }
  } catch { /* silent — non-fatal */ }
}

/**
 * Get recent events for a session.
 * @param {string} sessionId
 * @param {number} limit
 * @returns {object[]}
 */
export function getEvents(sessionId, limit = 50) {
  const session = sessions.get(sessionId);
  if (!session) return [];
  return session.events.slice(-limit);
}

/**
 * Reset a session's affective state.
 * @param {string} sessionId
 * @param {string} mode - "baseline" or "cooldown"
 */
export function resetSession(sessionId, mode = "baseline") {
  const { E, M } = engineReset(mode);
  const session = getSession(sessionId);
  session.E = E;
  session.M = M;
  // Keep event log for audit purposes
  logEvent(sessionId, {
    type: "CUSTOM",
    intensity: 0,
    polarity: 0,
    payload: { action: "reset", mode },
    source: { sessionId },
  });
  return { E: { ...E }, M: { ...M } };
}

/**
 * Delete a session entirely.
 */
export function deleteSession(sessionId) {
  return sessions.delete(sessionId);
}

/**
 * List all active session IDs.
 */
export function listSessions() {
  return Array.from(sessions.keys());
}

/**
 * Get session count (for metrics).
 */
export function sessionCount() {
  return sessions.size;
}

/**
 * Serialize all sessions for backup/persistence.
 */
export function serializeAll() {
  const out = {};
  for (const [id, session] of sessions) {
    out[id] = {
      E: { ...session.E },
      M: { ...session.M },
      events: session.events.slice(-100), // last 100 only for persistence
    };
  }
  return out;
}

/**
 * Restore sessions from serialized data.
 */
export function restoreAll(data) {
  if (!data || typeof data !== "object") return 0;
  let count = 0;
  for (const [id, session] of Object.entries(data)) {
    if (session.E && session.M) {
      sessions.set(id, {
        E: { ...session.E },
        M: { ...session.M },
        events: Array.isArray(session.events) ? session.events : [],
      });
      count++;
    }
  }
  return count;
}
