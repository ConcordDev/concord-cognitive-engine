// server/routes/digest.js
//
// Wave 3 / T2.2 — "While you were away" offline events digest.
//
//   GET /api/world/digest?worldId=concordia-hub
//
// Returns events from event_timeline_log from the caller's last departure
// window (or last 24h if no departure recorded) on a curated set of
// channels — enough to communicate "the world kept simulating without
// you" without flooding the player with the raw firehose.

import express from "express";
import { listRecent } from "../lib/event-timeline.js";

// Channels worth surfacing in the digest. Keep this conservative — the
// goal is the player understands what changed, not a wall of log entries.
const DIGEST_CHANNELS = [
  // Big sim moves
  "faction-strategy:move-applied",
  "faction:declared-war",
  "faction:proposed-truce",
  "faction:alliance-formed",
  "world:hybrid-spawned",
  "world:loot-dropped",
  "world:companion-tamed",
  "world:companion-bred",
  "world:building-state",
  "world:event:scheduled",
  "world:event:ended",
  "world:crisis",
  "world:crisis-resolved",
  // Lattice-born quests
  "lattice:meta:derived",
  "quest:lattice-spawned",
  // World events
  "weather:update",
  "season:transition",
  // Apprenticeship + leveling on player's owned NPCs
  "evo:asset-promoted",
];

const DEFAULT_WINDOW_S = 24 * 3600;          // 24h max
const MIN_WINDOW_S = 30 * 60;                 // skip digest if gap < 30 min

export default function createDigestRouter({ db, requireAuth }) {
  const router = express.Router();

  router.get("/digest", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });

    const worldId = (req.query?.worldId || "concordia-hub").toString();
    const now = Math.floor(Date.now() / 1000);

    // Determine the player's offline window. Prefer the latest closed
    // world_visit (departed_at) in this world; fall back to last_login_at
    // from users; final fallback is 24h.
    let sinceTs = now - DEFAULT_WINDOW_S;
    try {
      const visit = db.prepare(`
        SELECT departed_at FROM world_visits
        WHERE user_id = ? AND world_id = ? AND departed_at IS NOT NULL
        ORDER BY departed_at DESC LIMIT 1
      `).get(userId, worldId);
      if (visit?.departed_at) sinceTs = Math.max(sinceTs, visit.departed_at);
    } catch { /* table may not exist */ }
    try {
      const u = db.prepare(`SELECT last_login_at FROM users WHERE id = ?`).get(userId);
      if (u?.last_login_at) {
        const parsed = Date.parse(u.last_login_at);
        if (!Number.isNaN(parsed)) {
          const lastTs = Math.floor(parsed / 1000);
          // Only use it if it's earlier than the visit-derived window
          // and within the 24h cap.
          if (lastTs < sinceTs && lastTs > now - DEFAULT_WINDOW_S) {
            sinceTs = lastTs;
          }
        }
      }
    } catch { /* ok */ }

    const elapsed = now - sinceTs;
    const shouldShow = elapsed >= MIN_WINDOW_S;

    let events = [];
    try {
      events = listRecent(db, {
        channels: DIGEST_CHANNELS,
        worldId,
        sinceTs,
        limit: 200,
      });
    } catch { /* tolerate empty */ }

    // Group by channel for the UI to render section headers.
    const grouped = {};
    for (const ev of events) {
      const g = grouped[ev.channel] || (grouped[ev.channel] = []);
      g.push(ev);
    }

    return res.json({
      ok: true,
      worldId,
      sinceTs,
      now,
      elapsedSeconds: elapsed,
      shouldShow,
      eventCount: events.length,
      channels: Object.keys(grouped).sort(),
      events,
      grouped,
    });
  });

  return router;
}
