// server/migrations/253_programming_puzzles.js
//
// Phase CC3 — programming puzzle (Zachtronics / Human Resource Machine
// style). Tiny VM, 5 ops, scored by cycles + instruction-count size.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS programming_puzzles (
      id                   TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      description          TEXT,
      instruction_set_json TEXT NOT NULL DEFAULT '["MOV","ADD","JMP","JEZ","OUT"]',
      test_cases_json      TEXT NOT NULL,
      optimal_cycles       INTEGER,
      optimal_size         INTEGER,
      created_at           INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS programming_solutions (
      user_id      TEXT NOT NULL,
      puzzle_id    TEXT NOT NULL,
      program_json TEXT NOT NULL,
      cycles       INTEGER NOT NULL,
      size         INTEGER NOT NULL,
      submitted_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, puzzle_id)
    );
    CREATE INDEX IF NOT EXISTS idx_prog_sol_puzzle
      ON programming_solutions(puzzle_id, cycles ASC);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_prog_sol_puzzle;
    DROP TABLE IF EXISTS programming_solutions;
    DROP TABLE IF EXISTS programming_puzzles;
  `);
}
