// server/migrations/267_run_draft.js
//
// F4.1 — shared in-run draft. Generalises horde's pick-1-of-3 boon draft into a
// reusable substrate any run-mode (roguelite / extraction / horde) can use, with
// STRUCTURED effects that actually apply (not descriptive strings) + synergy
// detection. A generic picks table keyed by (run_kind, run_id) so one draft
// engine serves every mode.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_draft_picks (
      run_kind   TEXT NOT NULL,   -- 'roguelite' | 'extraction' | 'horde'
      run_id     TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      pick_id    TEXT NOT NULL,
      picked_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (run_kind, run_id, pick_id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_run_draft_run ON run_draft_picks(run_kind, run_id);`);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS run_draft_picks;`);
}
