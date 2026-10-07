// A chosen moment survives a process restart. cognitiveReplay is an
// in-memory object and is not on the shared lens-state key list. The
// row stores the title and the line. Role, brain, and a clock are not
// columns, so a restart does not invent them.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cognitive_replay_moments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      line TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cognitive_replay_moments_user
      ON cognitive_replay_moments (user_id, created_at);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS cognitive_replay_moments");
}
