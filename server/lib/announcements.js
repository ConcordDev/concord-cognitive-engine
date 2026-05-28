// server/lib/announcements.js
//
// Phase BB3 — operator announcements + roadmap feed.
//
// Patterned after the Phase AG ambient-chat substrate: rate-limit is
// admin-side (callers should gate the route), TTL + sweep heartbeat-
// friendly. Roadmap is just `kind='roadmap'` rows — same surface.

import crypto from "node:crypto";
import logger from "../logger.js";

const VALID_KINDS = new Set(["feature_drop", "balance_change", "event", "news", "roadmap"]);
const TITLE_MAX = 200;
const BODY_MAX = 8000;

export function publishAnnouncement(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  const { kind, title, body, expiresAt, dtuAttachmentId, authorUserId } = opts;
  if (!VALID_KINDS.has(kind)) return { ok: false, error: "invalid_kind" };
  if (!title || !body) return { ok: false, error: "missing_inputs" };

  const trimmedTitle = String(title).trim().slice(0, TITLE_MAX);
  const trimmedBody = String(body).trim().slice(0, BODY_MAX);
  if (!trimmedTitle || !trimmedBody) return { ok: false, error: "empty" };

  const id = `ann_${crypto.randomBytes(8).toString("hex")}`;
  try {
    db.prepare(`
      INSERT INTO announcements
        (id, kind, title, body_md, expires_at, dtu_attachment_id, author_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, kind, trimmedTitle, trimmedBody,
      expiresAt || null, dtuAttachmentId || null, authorUserId || null,
    );
    logger.info?.("announcements", "published", { id, kind, title: trimmedTitle });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listRecentAnnouncements(db, opts = {}) {
  if (!db) return [];
  try {
    const { kind, limit = 50 } = opts;
    const filters = ["(expires_at IS NULL OR expires_at > unixepoch())"];
    const args = [];
    if (kind && VALID_KINDS.has(kind)) { filters.push("kind = ?"); args.push(kind); }
    args.push(Math.max(1, Math.min(200, limit)));
    return db.prepare(`
      SELECT id, kind, title, body_md, published_at, expires_at,
             dtu_attachment_id, author_user_id
      FROM announcements
      WHERE ${filters.join(" AND ")}
      ORDER BY published_at DESC
      LIMIT ?
    `).all(...args);
  } catch { return []; }
}

export function sweepExpiredAnnouncements(db) {
  if (!db) return { ok: false };
  try {
    const r = db.prepare(`
      DELETE FROM announcements
      WHERE expires_at IS NOT NULL AND expires_at <= unixepoch()
    `).run();
    if (r.changes > 0) logger.debug?.("announcements", "sweep", { removed: r.changes });
    return { ok: true, removed: r.changes || 0 };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Pick announcements that haven't been broadcast yet, mark them
 * broadcast, and return them so the heartbeat can emit a socket event.
 * Idempotent via the last_broadcast_at column.
 */
export function dequeueBroadcastBatch(db, limit = 20) {
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT id, kind, title, body_md, published_at
      FROM announcements
      WHERE last_broadcast_at IS NULL
        AND (expires_at IS NULL OR expires_at > unixepoch())
      ORDER BY published_at ASC
      LIMIT ?
    `).all(Math.max(1, Math.min(100, limit)));
    if (rows.length === 0) return [];
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`
      UPDATE announcements SET last_broadcast_at = unixepoch()
      WHERE id IN (${placeholders})
    `).run(...ids);
    return rows;
  } catch { return []; }
}

export { VALID_KINDS };
