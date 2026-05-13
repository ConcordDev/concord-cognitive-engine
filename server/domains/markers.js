// server/domains/markers.js — Phase H2 player-placed POI markers.
import crypto from "node:crypto";

export default function registerMarkersMacros(register) {
  register("markers", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { worldId } = input || {};
    if (!worldId) return { ok: false, reason: "missing_worldId" };
    try {
      const rows = db.prepare(`
        SELECT * FROM world_markers WHERE world_id = ?
          AND (expires_at IS NULL OR expires_at > unixepoch())
        ORDER BY placed_at DESC LIMIT 200
      `).all(worldId);
      return { ok: true, markers: rows, count: rows.length };
    } catch {
      return { ok: true, markers: [], count: 0, reason: "world_markers_missing" };
    }
  }, { note: "List active markers in a world." });

  register("markers", "place", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "missing_inputs" };
    const { worldId, kind = "poi", label = null, x, z, ttlSeconds = 3600 } = input || {};
    if (!worldId || x == null || z == null) return { ok: false, reason: "missing_inputs" };
    const id = `mk_${crypto.randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO world_markers (id, world_id, kind, label, x, z, placed_by, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch() + ?)
      `).run(id, worldId, kind, label, Number(x), Number(z), userId, Math.max(60, Number(ttlSeconds) || 3600));
      return { ok: true, id };
    } catch (err) {
      return { ok: false, reason: "place_failed", error: err?.message };
    }
  }, { note: "Place a marker. Default TTL 1h." });

  register("markers", "remove", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "missing_inputs" };
    const { id } = input || {};
    if (!id) return { ok: false, reason: "missing_id" };
    try {
      const r = db.prepare(`DELETE FROM world_markers WHERE id = ? AND placed_by = ?`).run(id, userId);
      return { ok: r.changes > 0 };
    } catch (err) {
      return { ok: false, reason: "remove_failed", error: err?.message };
    }
  }, { note: "Remove a marker (owner-only)." });
}
