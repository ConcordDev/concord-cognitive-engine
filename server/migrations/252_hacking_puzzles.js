// server/migrations/252_hacking_puzzles.js
//
// Phase CC2 — hacking puzzle lens (Hacknet / Uplink style).
//
// Each puzzle is a small fake-filesystem tree the player navigates
// with `ls`, `cd`, `cat`, `connect`. The solution_path declares
// which commands must be issued in order to "compromise" the target.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hacking_puzzles (
      id                   TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      difficulty           INTEGER NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
      target_dtu_id        TEXT,
      terminal_tree_json   TEXT NOT NULL,
      solution_path_json   TEXT NOT NULL,
      reward_cc            REAL NOT NULL DEFAULT 50,
      created_at           INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS hacking_attempts (
      user_id          TEXT NOT NULL,
      puzzle_id        TEXT NOT NULL,
      started_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at     INTEGER,
      attempt_count    INTEGER NOT NULL DEFAULT 0,
      commands_log     TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (user_id, puzzle_id)
    );
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS hacking_attempts;
    DROP TABLE IF EXISTS hacking_puzzles;
  `);
}
