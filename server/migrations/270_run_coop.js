// server/migrations/270_run_coop.js
//
// C4 / F4.3 — co-op in runs. A party can share one extraction/horde run instead
// of each member soloing their own. Adds party_id to the run tables + a shared
// participant roster.

export function up(db) {
  for (const t of ["extraction_runs", "horde_runs"]) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all();
      if (cols.length && !cols.some((c) => c.name === "party_id")) {
        db.exec(`ALTER TABLE ${t} ADD COLUMN party_id TEXT`);
      }
    } catch { /* table may not exist on a minimal build */ }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_participants (
      run_kind   TEXT NOT NULL,
      run_id     TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      joined_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (run_kind, run_id, user_id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_run_participants_run ON run_participants(run_kind, run_id);`);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS run_participants;`);
}
