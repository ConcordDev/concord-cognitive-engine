// server/migrations/455_artistry_studies.js
//
// Study titles survive a process restart. artistryLens is an in-memory Map
// and is not on the shared lens-state key list. This table is the read-back
// for projectList after the process is gone.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS artistry_studies (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artistry_studies_user
      ON artistry_studies (user_id, updated_at);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS artistry_studies");
}
