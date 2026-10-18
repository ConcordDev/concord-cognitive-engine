// INC-100: getFeedEvents (emergent/feed.js) filters by emergent_id and orders
// by created_at DESC. The table only had idx_emergent_feed_time(created_at),
// so a per-emergent fetch walked the time index across all ~7.4M rows,
// filtering row by row (0.3s warm, ~7s cold for a rare emergent_id) — a
// synchronous better-sqlite3 stall on the event loop. Additive index; nothing
// altered or dropped. Build measured at ~9s on a clone of the 10.8GB prod DB.

export function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_emergent_feed_emergent_time
      ON emergent_activity_feed (emergent_id, created_at DESC);
  `);
}
