// server/migrations/457_film_studio_productions.js
//
// Production titles and scene headings survive a process restart.
// filmLens is an in-memory Map and is not on the shared lens-state key
// list. These tables are the read-back for project-list and scene-list
// after the process is gone.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS film_studio_productions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      format TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_film_studio_productions_user
      ON film_studio_productions (user_id, updated_at);

    CREATE TABLE IF NOT EXISTS film_studio_scenes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      number TEXT,
      int_ext TEXT,
      location TEXT NOT NULL,
      time_of_day TEXT,
      page_eighths INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_film_studio_scenes_project
      ON film_studio_scenes (user_id, project_id, created_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS film_studio_scenes;
    DROP TABLE IF EXISTS film_studio_productions;
  `);
}
