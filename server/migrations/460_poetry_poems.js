// server/migrations/460_poetry_poems.js
//
// Poem titles survive a process restart. poetryLens is an in-memory Map
// and is not on the shared lens-state key list. This table is the
// read-back for poem-list and poem-detail after the process is gone.
// The body is the poem. Form and status are not stored, so a restart
// does not invent them.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS poetry_poems (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_poetry_poems_user
      ON poetry_poems (user_id, updated_at);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS poetry_poems");
}
