// server/migrations/456_creative_writing_pages.js
//
// Page titles survive a process restart. writingLens is an in-memory Map
// and is not on the shared lens-state key list. This table is the read-back
// for project-list after the process is gone.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creative_writing_pages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_creative_writing_pages_user
      ON creative_writing_pages (user_id, updated_at);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS creative_writing_pages");
}
