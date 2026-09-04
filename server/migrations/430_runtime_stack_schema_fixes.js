// server/migrations/430_runtime_stack_schema_fixes.js
//
// Stack-merge runtime schema closure. PRs in the Runtime/Dila stack introduced
// readers for mission priority, Predict tickets, and SWE run persistence before
// the durable tables/columns existed in the migration stream.

export function up(db) {
  const missionCols = db.prepare(`PRAGMA table_info(mission_tasks)`).all().map((c) => c.name);
  if (missionCols.length && !missionCols.includes("priority_score")) {
    db.exec(`ALTER TABLE mission_tasks ADD COLUMN priority_score REAL NOT NULL DEFAULT 0.5`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS prediction_tickets (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL DEFAULT 'system',
      title           TEXT,
      subject_kind    TEXT,
      subject_id      TEXT,
      status          TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','in_progress','resolved','dismissed','failed')),
      priority_score  REAL NOT NULL DEFAULT 0.5,
      payload_json    TEXT,
      result_json     TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_prediction_tickets_status
      ON prediction_tickets(status, priority_score DESC, created_at DESC);

    CREATE TABLE IF NOT EXISTS runtime_swe_runs (
      id              TEXT PRIMARY KEY,
      suite           TEXT NOT NULL,
      case_id         TEXT NOT NULL,
      status          TEXT NOT NULL
                      CHECK (status IN ('passed','failed','cancelled','error')),
      patch_json      TEXT,
      result_json     TEXT,
      duration_ms     INTEGER,
      completed_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_swe_runs_suite
      ON runtime_swe_runs(suite, case_id, completed_at DESC);
  `);
}
