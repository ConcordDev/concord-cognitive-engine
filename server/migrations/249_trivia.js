// server/migrations/249_trivia.js
//
// Phase CB5 — DTU-native trivia / quiz sessions.
//
// Questions ARE DTUs. The DTU's claim IS the answer; the question
// is the prompt. Citation IS the submit — when a player cites the
// answer DTU, royalty cascade fires automatically.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trivia_questions (
      id              TEXT PRIMARY KEY,
      dtu_id          TEXT NOT NULL,
      question_text   TEXT NOT NULL,
      answer_dtu_id   TEXT NOT NULL,
      difficulty      INTEGER NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
      created_by      TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_trivia_q_difficulty
      ON trivia_questions(difficulty);

    CREATE TABLE IF NOT EXISTS trivia_sessions (
      id              TEXT PRIMARY KEY,
      host_user_id    TEXT NOT NULL,
      world_id        TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at        INTEGER,
      question_ids    TEXT NOT NULL DEFAULT '[]',
      score_board     TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS trivia_submissions (
      session_id      TEXT NOT NULL,
      question_id     TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      cited_dtu_id    TEXT NOT NULL,
      is_correct      INTEGER NOT NULL,
      submitted_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (session_id, question_id, user_id)
    );
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS trivia_submissions;
    DROP TABLE IF EXISTS trivia_sessions;
    DROP INDEX IF EXISTS idx_trivia_q_difficulty;
    DROP TABLE IF EXISTS trivia_questions;
  `);
}
