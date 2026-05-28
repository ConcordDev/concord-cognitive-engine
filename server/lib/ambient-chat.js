// server/lib/ambient-chat.js
//
// Phase AG — district ambient chat.
//
// Co-presence layer. Players in the same district see each other's
// messages without needing to be in a party. Ephemeral (1h default TTL,
// self-sweeping). Cross-district visibility is intentional zero —
// encourages district identity (Bakharev society-of-spectacle).

import crypto from "node:crypto";
import logger from "../logger.js";

const DEFAULT_TTL_S = 60 * 60;
const RATE_LIMIT_WINDOW_S = 60;
const RATE_LIMIT_MAX = 5;
const BODY_MAX_LEN = 280;

export function postAmbientMessage(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  const { userId, worldId, districtId, body, ttlSeconds = DEFAULT_TTL_S } = opts;
  if (!userId || !worldId || !districtId || !body) {
    return { ok: false, error: "missing_inputs" };
  }
  if (process.env.CONCORD_AMBIENT_CHAT_ENABLED === "0") {
    return { ok: false, error: "disabled" };
  }

  const trimmed = String(body).trim().slice(0, BODY_MAX_LEN);
  if (!trimmed) return { ok: false, error: "empty_body" };

  // Rate limit: max 5 messages per user per 60s.
  try {
    const since = Math.floor(Date.now() / 1000) - RATE_LIMIT_WINDOW_S;
    const r = db.prepare(`
      SELECT COUNT(*) AS n FROM ambient_chat_messages
      WHERE user_id = ? AND posted_at >= ?
    `).get(userId, since);
    if ((r?.n || 0) >= RATE_LIMIT_MAX) {
      return { ok: false, error: "rate_limited" };
    }
  } catch { /* table missing — fail open */ }

  const id = `amc_${crypto.randomBytes(8).toString("hex")}`;
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(60, ttlSeconds);

  try {
    db.prepare(`
      INSERT INTO ambient_chat_messages
        (id, world_id, district_id, user_id, body, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, worldId, districtId, userId, trimmed, expiresAt);
    return { ok: true, id, body: trimmed, expiresAt };
  } catch (err) {
    return { ok: false, error: err?.message || "db_error" };
  }
}

export function listRecentInDistrict(db, worldId, districtId, opts = {}) {
  if (!db || !worldId || !districtId) return [];
  try {
    const limit = Math.max(1, Math.min(100, opts.limit || 15));
    const now = Math.floor(Date.now() / 1000);
    return db.prepare(`
      SELECT id, user_id, body, posted_at
      FROM ambient_chat_messages
      WHERE world_id = ? AND district_id = ? AND expires_at > ?
      ORDER BY posted_at DESC, rowid DESC
      LIMIT ?
    `).all(worldId, districtId, now, limit);
  } catch { return []; }
}

export function sweepExpiredAmbientChat(db) {
  if (!db) return { ok: false };
  try {
    const r = db.prepare(`
      DELETE FROM ambient_chat_messages WHERE expires_at <= unixepoch()
    `).run();
    if (r.changes > 0) {
      logger.debug?.("ambient-chat", "sweep", { removed: r.changes });
    }
    return { ok: true, removed: r.changes || 0 };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export { DEFAULT_TTL_S, RATE_LIMIT_WINDOW_S, RATE_LIMIT_MAX, BODY_MAX_LEN };
