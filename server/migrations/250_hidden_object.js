// server/migrations/250_hidden_object.js
//
// Phase CB6 — hidden object scenes via photo gallery.
//
// Reuses BE1 photo gallery DTUs. A host marks objects at (x, y, w, h)
// bounding boxes on a photo; players play the scene by clicking the
// objects.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hidden_object_scenes (
      id                  TEXT PRIMARY KEY,
      scene_dtu_id        TEXT NOT NULL,
      host_user_id        TEXT NOT NULL,
      title               TEXT NOT NULL DEFAULT 'Untitled scene',
      target_objects_json TEXT NOT NULL DEFAULT '[]',
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS hidden_object_runs (
      id                  TEXT PRIMARY KEY,
      scene_id            TEXT NOT NULL,
      user_id             TEXT NOT NULL,
      started_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      finished_at         INTEGER,
      found_object_ids    TEXT NOT NULL DEFAULT '[]',
      score               INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ho_runs_scene
      ON hidden_object_runs(scene_id, score DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_ho_runs_scene;
    DROP TABLE IF EXISTS hidden_object_runs;
    DROP TABLE IF EXISTS hidden_object_scenes;
  `);
}
