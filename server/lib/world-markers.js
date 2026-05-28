// server/lib/world-markers.js
//
// Phase U6 — wire migration 188 (world_markers). Allies see each other's
// pings live; expired markers get swept by a heartbeat.

import crypto from "node:crypto";
import logger from "../logger.js";

const MARKER_CAP_PER_USER = Number(process.env.CONCORD_MARKER_CAP_PER_USER) || 20;
const VALID_KINDS = new Set(["poi", "quest", "caution", "celebration", "system"]);
const DEFAULT_TTL_S = 3600;

export function placeMarker(db, opts) {
  if (!db) return { ok: false, error: "no_db" };
  const userId = String(opts?.userId || "").trim();
  const worldId = String(opts?.worldId || "").trim();
  const kind = VALID_KINDS.has(opts?.kind) ? opts.kind : "poi";
  const label = String(opts?.label || "").slice(0, 80);
  const x = Number(opts?.x);
  const z = Number(opts?.z);
  if (!userId || !worldId) return { ok: false, error: "missing_inputs" };
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, error: "invalid_position" };
  const ttlS = Math.min(Math.max(60, Number(opts?.ttlSeconds) || DEFAULT_TTL_S), 86_400);

  // Per-user cap — sweep the oldest if at limit.
  try {
    const cnt = db.prepare(`
      SELECT COUNT(*) AS n FROM world_markers
      WHERE placed_by = ? AND (expires_at IS NULL OR expires_at > unixepoch())
    `).get(userId);
    if ((cnt?.n || 0) >= MARKER_CAP_PER_USER) {
      db.prepare(`
        DELETE FROM world_markers WHERE id = (
          SELECT id FROM world_markers
          WHERE placed_by = ?
          ORDER BY placed_at ASC LIMIT 1
        )
      `).run(userId);
    }
  } catch { /* table may differ on minimal builds */ }

  const id = `marker_${crypto.randomBytes(6).toString("hex")}`;
  try {
    db.prepare(`
      INSERT INTO world_markers (id, world_id, kind, label, x, z, placed_by, placed_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch() + ?)
    `).run(id, worldId, kind, label, x, z, userId, ttlS);
    return { ok: true, id, worldId, kind, label, x, z };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listMarkersForWorld(db, worldId, opts = {}) {
  if (!db || !worldId) return [];
  const limit = Math.min(Math.max(1, opts.limit || 100), 500);
  try {
    return db.prepare(`
      SELECT id, world_id AS worldId, kind, label, x, z,
             placed_by AS placedBy, placed_at AS placedAt, expires_at AS expiresAt
      FROM world_markers
      WHERE world_id = ? AND (expires_at IS NULL OR expires_at > unixepoch())
      ORDER BY placed_at DESC LIMIT ?
    `).all(worldId, limit);
  } catch {
    return [];
  }
}

export function removeMarker(db, markerId, userId) {
  if (!db || !markerId || !userId) return { ok: false, error: "missing_inputs" };
  try {
    const r = db.prepare(`DELETE FROM world_markers WHERE id = ? AND placed_by = ?`).run(markerId, userId);
    return r.changes > 0 ? { ok: true } : { ok: false, error: "not_found_or_not_owner" };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function sweepExpiredMarkers(db) {
  if (!db) return { swept: 0 };
  try {
    const r = db.prepare(`
      DELETE FROM world_markers WHERE expires_at IS NOT NULL AND expires_at <= unixepoch()
    `).run();
    return { swept: r.changes };
  } catch {
    return { swept: 0 };
  }
}
