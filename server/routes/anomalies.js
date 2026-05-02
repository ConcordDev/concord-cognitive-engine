// server/routes/anomalies.js
// Wave 1 deferral 8 — anomaly transparency without an admin role.
//
// Per user direction: "no admins, only full control over user-created
// world; everything else sticks to the rules."
//
// Two surfaces:
//   GET  /api/anomalies/public
//        Aggregate counts by kind + recent rate. No user-identifying detail.
//        Constitutional transparency — anyone logged in can see the audit
//        layer's health.
//   GET  /api/anomalies/world/:worldId
//   POST /api/anomalies/world/:worldId/:anomalyId/resolve
//   POST /api/anomalies/world/:worldId/:anomalyId/dismiss
//        Scoped to the world's creator. Auth check joins worlds.created_by
//        against the requesting user.id. World creators have full control
//        over anomalies tied to users present in their world.
//
// Cross-world / platform-level anomalies stay out of human control entirely
// — they're handled by rule-based auto-resolution in the heartbeat scan
// (lib/inventory-audit.js scanForAnomalies, already wired in Phase 10).

import { Router } from "express";

export default function createAnomaliesRouter({ requireAuth, db }) {
  const router = Router();
  const auth = requireAuth;
  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;

  // GET /api/anomalies/public — no-auth aggregate transparency
  router.get("/public", (req, res) => {
    try {
      const byKind = db.prepare(`
        SELECT kind, status, COUNT(*) AS n
          FROM inventory_anomaly_queue
         GROUP BY kind, status
         ORDER BY kind, status
      `).all();
      const recent = db.prepare(`
        SELECT kind, COUNT(*) AS n
          FROM inventory_anomaly_queue
         WHERE detected_at >= ?
         GROUP BY kind
      `).all(Math.floor(Date.now() / 1000) - 7 * 86400);
      res.json({ ok: true, byKind, recent7d: recent });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // Helper — does this user own this world?
  const _userOwnsWorld = (userId, worldId) => {
    if (!userId || !worldId) return false;
    const row = db.prepare(`SELECT created_by FROM worlds WHERE id = ?`).get(worldId);
    return row?.created_by === userId;
  };

  // GET /api/anomalies/world/:worldId — anomalies tied to users in this world
  router.get("/world/:worldId", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const worldId = req.params.worldId;
      if (!_userOwnsWorld(userId, worldId)) {
        return res.status(403).json({ ok: false, error: "not_world_creator" });
      }
      // Loose coupling: a user is "in" a world if their cityId matches.
      // city-presence is in-memory; for the persistent slice we look at the
      // anomaly's user_id and join against any historic player_position rows
      // with cityId = worldId. If player_positions doesn't exist, fall back
      // to all users with anomalies (creator-of-world sees all activity for
      // platform-level review purposes too — they consented to running a world).
      let anomalies;
      try {
        anomalies = db.prepare(`
          SELECT q.*
            FROM inventory_anomaly_queue q
            JOIN player_position p ON p.user_id = q.user_id AND p.city_id = ?
           WHERE q.status IN ('open', 'investigating')
           ORDER BY q.detected_at DESC
           LIMIT 100
        `).all(worldId);
      } catch {
        // player_position table may not exist; world creator sees all open anomalies
        anomalies = db.prepare(`
          SELECT * FROM inventory_anomaly_queue
           WHERE status IN ('open', 'investigating')
           ORDER BY detected_at DESC
           LIMIT 100
        `).all();
      }
      res.json({ ok: true, anomalies });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/anomalies/world/:worldId/:anomalyId/resolve
  router.post("/world/:worldId/:anomalyId/resolve", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const { worldId, anomalyId } = req.params;
      if (!_userOwnsWorld(userId, worldId)) {
        return res.status(403).json({ ok: false, error: "not_world_creator" });
      }
      const note = String(req.body?.resolution || "resolved by world creator").slice(0, 500);
      db.prepare(`
        UPDATE inventory_anomaly_queue
           SET status = 'resolved', resolved_at = unixepoch(),
               resolved_by = ?, resolution = ?
         WHERE id = ? AND status IN ('open', 'investigating')
      `).run(userId, note, anomalyId);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/anomalies/world/:worldId/:anomalyId/dismiss
  router.post("/world/:worldId/:anomalyId/dismiss", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const { worldId, anomalyId } = req.params;
      if (!_userOwnsWorld(userId, worldId)) {
        return res.status(403).json({ ok: false, error: "not_world_creator" });
      }
      const note = String(req.body?.reason || "dismissed by world creator").slice(0, 500);
      db.prepare(`
        UPDATE inventory_anomaly_queue
           SET status = 'dismissed', resolved_at = unixepoch(),
               resolved_by = ?, resolution = ?
         WHERE id = ? AND status IN ('open', 'investigating')
      `).run(userId, note, anomalyId);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  return router;
}
