// server/lib/player-signs.js
//
// Theme deferred (game-feel pass): async-cooperation player signs.
// Death Stranding pattern — players drop short-lived signposts in the
// world (arrow / warning / praise / help / poi) that other players see.
// Migration 146 holds the table; this lib is the canonical CRUD.
//
// Constraints:
//   - SIGN_TTL_DAYS = 7              (default expiry from now)
//   - MAX_ACTIVE_PER_USER = 50       (rate-limit floor; 503 when exceeded)
//   - PLACE_COOLDOWN_S = 60          (per-user; spam guard)
//   - ALLOWED_KINDS = arrow|warning|praise|help|poi
//   - MESSAGE_MAX_LEN = 80
//
// All functions are pure-ish: db is the only side-effect. Best-effort
// realtime emit on placement so other connected clients see the sign
// pop in immediately.

import crypto from "node:crypto";

export const ALLOWED_KINDS = new Set(["arrow", "warning", "praise", "help", "poi"]);
export const SIGN_TTL_DAYS = 7;
export const MAX_ACTIVE_PER_USER = 50;
export const PLACE_COOLDOWN_S = 60;
export const MESSAGE_MAX_LEN = 80;
export const NEARBY_DEFAULT_RADIUS_M = 60;
export const MAX_NEARBY_LIMIT = 200;

function _ttlSecondsFromNow(days = SIGN_TTL_DAYS) {
  return Math.floor(Date.now() / 1000) + days * 86400;
}

/** Place a new sign. Returns { ok, sign? , reason? }. */
export function placeSign(db, opts) {
  if (!db || !opts) return { ok: false, reason: "no_input" };
  const { userId, worldId, position, kind, message = null } = opts;
  if (!userId || !worldId || !position) return { ok: false, reason: "missing_fields" };
  if (!ALLOWED_KINDS.has(kind)) return { ok: false, reason: "bad_kind" };
  const x = Number(position.x);
  const y = Number(position.y ?? 0);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: "bad_position" };
  const msg = message ? String(message).slice(0, MESSAGE_MAX_LEN) : null;
  const now = Math.floor(Date.now() / 1000);

  // Active-count cap.
  let active = 0;
  try {
    const r = db.prepare(`
      SELECT COUNT(*) AS c FROM player_signs
       WHERE user_id = ? AND expires_at > ?
    `).get(userId, now);
    active = Number(r?.c ?? 0);
  } catch { /* table missing on minimal builds */ }
  if (active >= MAX_ACTIVE_PER_USER) {
    return { ok: false, reason: "active_limit", active };
  }

  // Cooldown check — most-recent sign by this user.
  try {
    const r = db.prepare(`
      SELECT created_at FROM player_signs
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(userId);
    if (r && now - Number(r.created_at) < PLACE_COOLDOWN_S) {
      return { ok: false, reason: "cooldown", retryAt: Number(r.created_at) + PLACE_COOLDOWN_S };
    }
  } catch { /* ignore */ }

  const id = `sign_${crypto.randomUUID()}`;
  const expiresAt = _ttlSecondsFromNow();

  try {
    db.prepare(`
      INSERT INTO player_signs (id, world_id, user_id, x, y, z, kind, message, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, worldId, userId, x, y, z, kind, msg, now, expiresAt);
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }

  // Realtime fan-out — best-effort.
  try {
    const io = globalThis?.__CONCORD_REALTIME__?.io;
    io?.to(`world:${worldId}`).emit("world:sign-placed", {
      id, worldId, userId, x, y, z, kind, message: msg, expiresAt,
    });
  } catch { /* emit optional */ }

  return {
    ok: true,
    sign: { id, worldId, userId, x, y, z, kind, message: msg, createdAt: now, expiresAt },
  };
}

/** List nearby active signs in a world. Returns up to `limit` rows
 *  sorted by descending recency. */
export function signsNearby(db, opts) {
  if (!db || !opts) return [];
  const { worldId, position, radiusM = NEARBY_DEFAULT_RADIUS_M, limit = 50 } = opts;
  if (!worldId) return [];
  const now = Math.floor(Date.now() / 1000);
  const r = Math.max(1, Math.min(500, Number(radiusM)));
  const cap = Math.max(1, Math.min(MAX_NEARBY_LIMIT, Number(limit)));
  const x = Number(position?.x);
  const z = Number(position?.z);
  const hasPos = Number.isFinite(x) && Number.isFinite(z);

  try {
    if (hasPos) {
      return db.prepare(`
        SELECT id, world_id, user_id, x, y, z, kind, message, created_at, expires_at
          FROM player_signs
         WHERE world_id = ?
           AND expires_at > ?
           AND ABS(x - ?) <= ? AND ABS(z - ?) <= ?
         ORDER BY created_at DESC
         LIMIT ?
      `).all(worldId, now, x, r, z, r, cap)
        .filter((row) => Math.hypot(Number(row.x) - x, Number(row.z) - z) <= r);
    }
    return db.prepare(`
      SELECT id, world_id, user_id, x, y, z, kind, message, created_at, expires_at
        FROM player_signs
       WHERE world_id = ? AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT ?
    `).all(worldId, now, cap);
  } catch { return []; }
}

/** List signs the user owns (active only). */
export function mySigns(db, opts) {
  if (!db || !opts) return [];
  const { userId, limit = 50 } = opts;
  if (!userId) return [];
  const now = Math.floor(Date.now() / 1000);
  const cap = Math.max(1, Math.min(MAX_NEARBY_LIMIT, Number(limit)));
  try {
    return db.prepare(`
      SELECT id, world_id, user_id, x, y, z, kind, message, created_at, expires_at
        FROM player_signs
       WHERE user_id = ? AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT ?
    `).all(userId, now, cap);
  } catch { return []; }
}

/** Owner-only removal. Returns { ok, reason? }. */
export function removeSign(db, opts) {
  if (!db || !opts) return { ok: false, reason: "no_input" };
  const { userId, signId } = opts;
  if (!userId || !signId) return { ok: false, reason: "missing_fields" };
  try {
    const r = db.prepare(`
      DELETE FROM player_signs WHERE id = ? AND user_id = ?
    `).run(signId, userId);
    if (r.changes === 0) return { ok: false, reason: "not_found_or_forbidden" };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "delete_failed", error: err?.message };
  }
}

/** Hard-delete expired rows. Returns count removed. */
export function cleanupExpiredSigns(db) {
  if (!db) return 0;
  try {
    const r = db.prepare(`
      DELETE FROM player_signs WHERE expires_at <= unixepoch()
    `).run();
    return r.changes;
  } catch { return 0; }
}
