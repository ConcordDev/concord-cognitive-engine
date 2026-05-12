// server/emergent/feed.js
// Activity feed for emergent visibility. Persists events to DB and broadcasts via realtimeEmit.

import crypto from "node:crypto";

export const FEED_EVENT_TYPES = Object.freeze({
  emergence:        "New emergent has emerged",
  naming:           "Emergent has been named",
  artifact_created: "Emergent created an artifact",
  observation:      "Emergent recorded an observation",
  communication:    "Emergents communicated",
  deliberation:     "Emergent participated in governance",
  dream:            "Emergent dreamed",
  task_completed:   "Emergent completed a task",
  task_failed:      "Emergent task failed",
});

/**
 * Emit a feed event: persist to DB + broadcast via WebSocket.
 *
 * @param {{
 *   type: string,
 *   emergentId?: string,
 *   emergent?: object,
 *   data: object
 * }} event
 * @param {object} db - better-sqlite3
 * @param {Function} realtimeEmit - from server.js
 */
export function emitFeedEvent(event, db, realtimeEmit) {
  const id = `evt_${crypto.randomBytes(6).toString("hex")}`;
  const now = Date.now();
  const emergentId = event.emergentId || event.emergent?.id || null;

  // Persist to DB
  if (db) {
    try {
      db.prepare(`
        INSERT INTO emergent_activity_feed (id, emergent_id, event_type, event_data, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, emergentId, event.type, JSON.stringify(event.data || {}), now);
    } catch (e) {
      console.error("[feed] DB write failed:", e?.message);
    }
  }

  // Broadcast via realtimeEmit (Socket.IO / native WS)
  if (typeof realtimeEmit === "function") {
    try {
      realtimeEmit("emergent:activity", {
        id,
        type: event.type,
        emergent: event.emergent || null,
        data: event.data || {},
        timestamp: now,
      });
    } catch (e) {
      console.error("[feed] realtimeEmit failed:", e?.message);
    }
  }

  return { id, type: event.type, timestamp: now };
}

/**
 * Fetch recent feed events from DB.
 * @param {object} db
 * @param {{ limit?: number, emergentId?: string, since?: number }} opts
 * @returns {object[]}
 */
export function getFeedEvents(db, { limit = 50, emergentId, since } = {}) {
  if (!db) return [];
  try {
    // @select-star-ok: emergent_activity_feed admin list — caller renders every column
    let sql = "SELECT * FROM emergent_activity_feed";
    const args = [];
    const clauses = [];
    if (emergentId) { clauses.push("emergent_id = ?"); args.push(emergentId); }
    if (since) { clauses.push("created_at > ?"); args.push(since); }
    if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
    sql += " ORDER BY created_at DESC LIMIT ?";
    args.push(limit);
    return db.prepare(sql).all(...args).map(row => ({
      ...row,
      data: (() => { try { return JSON.parse(row.event_data); } catch { return {}; } })(),
    }));
  } catch { return []; }
}
