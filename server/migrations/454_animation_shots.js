// server/migrations/454_animation_shots.js
//
// Shot titles survive a process restart. animationLens is an in-memory Map
// and is not on the shared lens-state key list. This table is the read-back
// for anim-list after the process is gone.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS animation_shots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_animation_shots_user
      ON animation_shots (user_id, updated_at);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS animation_shots");
}
