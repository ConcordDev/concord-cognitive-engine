// server/migrations/199_reels.js
//
// Phase 11 (Item 6) — short-form vertical video (Reels) substrate.
//
// `social_posts` lives in memory; reels need durable storage for the
// video metadata + per-viewer analytics (the algorithmic feed needs
// real watch-completion rates, never fabricated).
//
// Two tables:
//
//   reels — one row per published reel. Links back to the in-memory
//           social post id (so reactions / comments / shares /
//           bookmarks reuse the existing pan-social primitives).
//
//   reel_views — append-only analytics ledger. One row per (reel,
//                viewer, watch session). `completed` = 1 when
//                watched_seconds >= 0.8 * duration_seconds.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reels (
      id                  TEXT PRIMARY KEY,
      post_id             TEXT NOT NULL,
      user_id             TEXT NOT NULL,
      video_url           TEXT NOT NULL,
      thumbnail_url       TEXT,
      duration_seconds    REAL NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 60),
      width               INTEGER,
      height              INTEGER,
      caption             TEXT,
      music_attribution   TEXT,
      view_count          INTEGER NOT NULL DEFAULT 0,
      completion_count    INTEGER NOT NULL DEFAULT 0,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reels_user    ON reels(user_id, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reels_created ON reels(created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reels_post    ON reels(post_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS reel_views (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      reel_id             TEXT NOT NULL,
      viewer_user_id      TEXT,
      watched_seconds     REAL NOT NULL,
      completed           INTEGER NOT NULL DEFAULT 0,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reel_views_reel ON reel_views(reel_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reel_views_viewer ON reel_views(viewer_user_id, created_at)`);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_reel_views_viewer`);
  db.exec(`DROP INDEX IF EXISTS idx_reel_views_reel`);
  db.exec(`DROP TABLE IF EXISTS reel_views`);
  db.exec(`DROP INDEX IF EXISTS idx_reels_post`);
  db.exec(`DROP INDEX IF EXISTS idx_reels_created`);
  db.exec(`DROP INDEX IF EXISTS idx_reels_user`);
  db.exec(`DROP TABLE IF EXISTS reels`);
}
