// server/migrations/054_player_ratings.js
// Elo rating table — tracks each player's matchmaking rating, win/loss record.
// Default rating 1200 (standard Elo starting point).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_ratings (
      user_id     TEXT PRIMARY KEY,
      rating      INTEGER NOT NULL DEFAULT 1200,
      wins        INTEGER NOT NULL DEFAULT 0,
      losses      INTEGER NOT NULL DEFAULT 0,
      win_streak  INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_player_ratings_rating ON player_ratings(rating);
  `);
}
