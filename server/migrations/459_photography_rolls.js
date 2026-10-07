// server/migrations/459_photography_rolls.js
//
// Roll names survive a process restart. photographyLens is an in-memory
// Map and is not on the shared lens-state key list. This table is the
// read-back for shoot-list after the process is gone.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS photography_rolls (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photography_rolls_user
      ON photography_rolls (user_id, created_at);
    CREATE TABLE IF NOT EXISTS photography_roll_frames (
      id TEXT PRIMARY KEY,
      roll_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photography_roll_frames_roll
      ON photography_roll_frames (roll_id, created_at);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS photography_roll_frames");
  db.exec("DROP TABLE IF EXISTS photography_rolls");
}
