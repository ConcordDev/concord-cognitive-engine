// Migration 129 — Phase 3: Personal Beat Scheduler.
//
// Surfaces forward-sim predictions to the player as in-world prompts
// delivered through the goddess / oracle. Each beat references an
// existing forward_predictions row; when the player acts on it, the
// beat is realised + the prediction is realised + metrics shift.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_beats (
      id              TEXT    PRIMARY KEY,
      user_id         TEXT    NOT NULL,
      world_id        TEXT    NOT NULL,
      prediction_id   TEXT    NOT NULL,
      prose           TEXT    NOT NULL,
      surfaced_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at    INTEGER,
      outcome         TEXT
                      CHECK (outcome IS NULL OR outcome IN ('realised', 'ignored', 'rejected', 'expired'))
    );
    CREATE INDEX IF NOT EXISTS idx_pb_user_open ON player_beats(user_id, completed_at);
    CREATE INDEX IF NOT EXISTS idx_pb_prediction ON player_beats(prediction_id);
    CREATE INDEX IF NOT EXISTS idx_pb_surfaced ON player_beats(surfaced_at);
  `);
}

export function down(_db) { /* forward-only */ }
