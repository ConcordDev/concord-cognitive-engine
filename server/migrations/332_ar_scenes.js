// server/migrations/332_ar_scenes.js
//
// AR scene persistence — the deferred half of the AR track. The WebXR
// immersive-ar + hit-test surface is real (ARPreview.tsx / SceneStudio.tsx),
// but authored scenes lived only in globalThis._concordSTATE.arLens (lost on
// restart). These tables back domains/ar.js so scenes, image targets, and
// publish records survive a restart, keyed per-user.
//
// Uniform key-value-by-user shape (the rich object lives in data_json) so one
// store facade backs all three. Forward-only; table-guarded.

export function up(db) {
  for (const table of ["ar_scenes", "ar_image_targets", "ar_publishes"]) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_user ON ${table}(user_id, updated_at)`);
  }
}

export function down(db) {
  for (const table of ["ar_scenes", "ar_image_targets", "ar_publishes"]) {
    db.exec(`DROP INDEX IF EXISTS idx_${table}_user`);
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
}
