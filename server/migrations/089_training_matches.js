// server/migrations/089_training_matches.js
//
// PvP Training Match table. Two players queue or directly challenge;
// they fight to a soft threshold (default ~50% HP), either side can
// trigger a Safe Reset (full heal both sides, brief safe-zone bubble),
// they fight again. Every action lands in combat_flows for both fighters
// (via the existing flow recorder) so both players co-evolve combos
// against the same opponent over hundreds of rounds.
//
// State machine:
//   pending  → both players agreed, awaiting world-spawn confirmation
//   active   → currently fighting (one or more rounds in progress)
//   reset    → safe-reset phase (HP/stamina restored, ~3s safe zone)
//   ended    → match concluded (forfeit, mutual exit, or cap reached)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS training_matches (
      id              TEXT PRIMARY KEY,
      initiator_id    TEXT NOT NULL,
      opponent_id     TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',  -- pending|active|reset|ended
      mode            TEXT NOT NULL DEFAULT 'training', -- training|sparring|exhibition
      hp_threshold    REAL NOT NULL DEFAULT 0.5,        -- 0.5 = 50% HP triggers reset prompt
      rounds_played   INTEGER NOT NULL DEFAULT 0,
      max_rounds      INTEGER NOT NULL DEFAULT 20,
      initiator_wins  INTEGER NOT NULL DEFAULT 0,
      opponent_wins   INTEGER NOT NULL DEFAULT 0,
      ended_reason    TEXT,                             -- forfeit|cap|mutual|disconnect
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at        INTEGER,
      UNIQUE(initiator_id, opponent_id, created_at)
    );
    CREATE INDEX IF NOT EXISTS idx_training_matches_active
      ON training_matches(status, initiator_id, opponent_id);
    CREATE INDEX IF NOT EXISTS idx_training_matches_player
      ON training_matches(initiator_id);
    CREATE INDEX IF NOT EXISTS idx_training_matches_opponent
      ON training_matches(opponent_id);
  `);

  // Per-round log so each round's outcome + flow id is replayable
  db.exec(`
    CREATE TABLE IF NOT EXISTS training_match_rounds (
      id              TEXT PRIMARY KEY,
      match_id        TEXT NOT NULL,
      round_number    INTEGER NOT NULL,
      winner_id       TEXT,                             -- null = mutual / undecided
      duration_ms     INTEGER NOT NULL DEFAULT 0,
      initiator_chain TEXT NOT NULL DEFAULT '',         -- comma-separated action sequence
      opponent_chain  TEXT NOT NULL DEFAULT '',
      ended_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_training_rounds_match
      ON training_match_rounds(match_id, round_number);
  `);
}

export function down(_db) { /* sqlite — leave tables in place */ }
