// server/migrations/436_dhtp_cognitive.js
//
// DHTP learning loop + cognitive solution cache.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dhtp_learned_policies (
      field               TEXT NOT NULL,
      task_class          TEXT NOT NULL DEFAULT '*',
      compression_level   TEXT NOT NULL CHECK (compression_level IN (
        'verbatim','compact','hash','archive','forget','recover_on_demand'
      )),
      success_rate        REAL NOT NULL DEFAULT 0,
      sample_count        INTEGER NOT NULL DEFAULT 0,
      confidence          REAL NOT NULL DEFAULT 0,
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (field, task_class)
    );

    CREATE TABLE IF NOT EXISTS cognitive_solution_cache (
      fingerprint_hash    TEXT PRIMARY KEY,
      mission_template    TEXT,
      step_tool           TEXT,
      goal_signature      TEXT,
      solution_json       TEXT NOT NULL,
      delta_json          TEXT,
      use_count           INTEGER NOT NULL DEFAULT 0,
      success_count       INTEGER NOT NULL DEFAULT 0,
      verified_at         INTEGER,
      last_used_at        INTEGER,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_cognitive_cache_tool ON cognitive_solution_cache(step_tool, success_count DESC);

    CREATE TABLE IF NOT EXISTS dhtp_field_outcomes (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id          TEXT,
      step_index          INTEGER,
      task_class          TEXT,
      field               TEXT NOT NULL,
      compression_level   TEXT NOT NULL,
      task_success        INTEGER,
      recovery_required   INTEGER,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_dhtp_field_outcomes_field ON dhtp_field_outcomes(field, task_class, created_at DESC);
  `);

  try {
    db.exec(`ALTER TABLE dhtp_metrics ADD COLUMN policy_json TEXT`);
  } catch { /* column may exist */ }
}
