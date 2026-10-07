// server/migrations/458_game_designs.js
//
// Design titles survive a process restart. gameDesignLens is an in-memory
// Map and is not on the shared lens-state key list. This table is the
// read-back for game-list after the process is gone.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_designs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_game_designs_user
      ON game_designs (user_id, updated_at);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS game_designs");
}
