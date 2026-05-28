// server/lib/climbing.js
//
// Phase CA3 — climbing route ledger.
//
// `player-stamina.js#setState('climbing')` already gates entry into
// the climbing state. Callers (the world physics layer) detect when a
// climb ends (returned to ground OR exhausted) and record the route
// here via recordRoute. Height is end_y - start_y; achievements unlock
// at thresholds.

import crypto from "node:crypto";
import logger from "../logger.js";

export function recordRoute(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const {
    worldId, startX, startY, startZ, endX, endY, endZ,
    peakAltitude, durationS,
  } = opts;
  if (!worldId) return { ok: false, error: "missing_worldId" };
  if ([startX, startY, startZ, endX, endY, endZ].some(v => typeof v !== "number")) {
    return { ok: false, error: "invalid_coords" };
  }

  const height = Math.max(0, (peakAltitude ?? endY) - startY);
  const id = `clr_${crypto.randomBytes(6).toString("hex")}`;

  try {
    db.prepare(`
      INSERT INTO climbing_routes
        (id, user_id, world_id, start_x, start_y, start_z,
         end_x, end_y, end_z, peak_altitude, height_climbed, duration_s)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId, worldId,
      startX, startY, startZ, endX, endY, endZ,
      peakAltitude ?? endY,
      height,
      Math.max(0, Math.floor(Number(durationS) || 0)),
    );
    logger.info?.("climbing", "route_recorded", { userId, worldId, height });
    return { ok: true, id, heightClimbed: height };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listRoutes(db, userId, limit = 20) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, world_id, start_y, end_y, peak_altitude, height_climbed,
             duration_s, completed_at
      FROM climbing_routes WHERE user_id = ?
      ORDER BY completed_at DESC, rowid DESC LIMIT ?
    `).all(userId, Math.max(1, Math.min(500, limit)));
  } catch { return []; }
}

export function getTopRoutes(db, worldId, limit = 10) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT id, user_id, peak_altitude, height_climbed, duration_s, completed_at
      FROM climbing_routes WHERE world_id = ?
      ORDER BY height_climbed DESC LIMIT ?
    `).all(worldId, Math.max(1, Math.min(100, limit)));
  } catch { return []; }
}

export function countTallRoutes(db, userId, minHeight = 100) {
  if (!db || !userId) return 0;
  try {
    const r = db.prepare(`
      SELECT COUNT(*) AS n FROM climbing_routes
      WHERE user_id = ? AND height_climbed >= ?
    `).get(userId, minHeight);
    return r?.n || 0;
  } catch { return 0; }
}
