// server/migrations/430_dila_waves_abcd.js
//
// Waves A–D — mission priority, SWE harness runs, deployment profile KV.

export function up(db) {
  db.exec(`
    ALTER TABLE mission_tasks ADD COLUMN priority_score REAL NOT NULL DEFAULT 0.5;
    CREATE INDEX IF NOT EXISTS idx_mission_priority
      ON mission_tasks(status, priority_score DESC, next_tick_at ASC);

    CREATE TABLE IF NOT EXISTS runtime_swe_runs (
      id              TEXT    PRIMARY KEY,
      suite           TEXT    NOT NULL,
      case_id         TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','running','passed','failed','skipped')),
      patch_json      TEXT,
      result_json     TEXT,
      duration_ms     INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_swe_runs_suite
      ON runtime_swe_runs(suite, created_at DESC);
  `);
}
