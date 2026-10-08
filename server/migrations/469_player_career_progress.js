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
      updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, track_id)
    );
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS player_career_progress");
}
