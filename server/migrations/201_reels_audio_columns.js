// server/migrations/201_reels_audio_columns.js
//
// Phase 13 (Stage B) — extend `reels` to admit audio-only entries.
//
// Pre-Phase-13 `reels.video_url TEXT NOT NULL`. Audio-only reels need a
// nullable video_url. SQLite can't drop NOT NULL in place, so this rebuilds
// the table with foreign_keys=OFF (the only FK is reel_views.reel_id with
// CASCADE delete — we recreate the data, then restore the FK).
//
// New columns:
//   audio_url           TEXT — when set, this is an audio-only reel
//   audio_duration_s    INTEGER — independent of duration_seconds because
//                                 a video reel could ALSO have a separate
//                                 audio track (future); for now == duration
//                                 for audio-only reels.
//
// A row qualifies as audio-only when `video_url IS NULL AND audio_url IS NOT NULL`.
// New CHECK ensures at least one media URL is set.

export function up(db) {
  db.exec(`PRAGMA foreign_keys=OFF`);
  // legacy_alter_table=ON prevents SQLite from auto-rewriting the
  // `reel_views.reel_id REFERENCES reels(id)` constraint to point at
  // `reels_pre_201` during the RENAME. Without it, the FK ends up
  // dangling after we DROP reels_pre_201 and subsequent INSERTs into
  // reel_views fail with "no such table: reels_pre_201".
  db.exec(`PRAGMA legacy_alter_table=ON`);
  try {
    db.exec(`ALTER TABLE reels RENAME TO reels_pre_201`);
    db.exec(`
      CREATE TABLE reels (
        id                  TEXT PRIMARY KEY,
        post_id             TEXT NOT NULL,
        user_id             TEXT NOT NULL,
        video_url           TEXT,
        thumbnail_url       TEXT,
        audio_url           TEXT,
        audio_duration_s    INTEGER,
        duration_seconds    REAL NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 60),
        width               INTEGER,
        height              INTEGER,
        caption             TEXT,
        music_attribution   TEXT,
        view_count          INTEGER NOT NULL DEFAULT 0,
        completion_count    INTEGER NOT NULL DEFAULT 0,
        created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
        CHECK (video_url IS NOT NULL OR audio_url IS NOT NULL)
      )
    `);
    db.exec(`
      INSERT INTO reels (
        id, post_id, user_id, video_url, thumbnail_url,
        duration_seconds, width, height, caption, music_attribution,
        view_count, completion_count, created_at
      )
      SELECT
        id, post_id, user_id, video_url, thumbnail_url,
        duration_seconds, width, height, caption, music_attribution,
        view_count, completion_count, created_at
      FROM reels_pre_201
    `);
    db.exec(`DROP TABLE reels_pre_201`);

    // Recreate the indexes from migration 199 + a new one for audio-only
    // filtering.
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reels_user    ON reels(user_id, created_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reels_created ON reels(created_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reels_post    ON reels(post_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reels_audio_only ON reels(created_at DESC) WHERE video_url IS NULL AND audio_url IS NOT NULL`);
  } finally {
    db.exec(`PRAGMA legacy_alter_table=OFF`);
    db.exec(`PRAGMA foreign_keys=ON`);
  }
}

export function down(db) {
  db.exec(`PRAGMA foreign_keys=OFF`);
  db.exec(`PRAGMA legacy_alter_table=ON`);
  try {
    // Drop audio-only rows (they would violate the video_url NOT NULL
    // constraint of the pre-201 schema).
    db.exec(`DELETE FROM reels WHERE video_url IS NULL`);
    db.exec(`ALTER TABLE reels RENAME TO reels_post_201`);
    db.exec(`
      CREATE TABLE reels (
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
    db.exec(`
      INSERT INTO reels (id, post_id, user_id, video_url, thumbnail_url, duration_seconds, width, height, caption, music_attribution, view_count, completion_count, created_at)
      SELECT id, post_id, user_id, video_url, thumbnail_url, duration_seconds, width, height, caption, music_attribution, view_count, completion_count, created_at
      FROM reels_post_201
    `);
    db.exec(`DROP TABLE reels_post_201`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reels_user    ON reels(user_id, created_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reels_created ON reels(created_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reels_post    ON reels(post_id)`);
  } finally {
    db.exec(`PRAGMA legacy_alter_table=OFF`);
    db.exec(`PRAGMA foreign_keys=ON`);
  }
}
