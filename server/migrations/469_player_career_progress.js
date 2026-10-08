// Careers: persisted per-track progression so the server (not the client)
// owns a player's tier, promotion XP and mastery.
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_career_progress (
      user_id          TEXT NOT NULL,
      track_id         TEXT NOT NULL,
      tier             INTEGER NOT NULL DEFAULT 1,
      xp               INTEGER NOT NULL DEFAULT 0,
      highest_tier     INTEGER NOT NULL DEFAULT 1,
      shifts           INTEGER NOT NULL DEFAULT 0,
      last_shift_day   TEXT,
      last_shift_at    INTEGER,
      updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, track_id)
    );
    CREATE INDEX IF NOT EXISTS idx_player_career_progress_user ON player_career_progress (user_id, last_shift_at);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS player_career_progress");
}
