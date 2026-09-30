// server/migrations/433_pce_bench_runs.js
//
// PCEBench run history + pattern proposals from failure analysis.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pce_bench_runs (
      id              TEXT    PRIMARY KEY,
      suite           TEXT    NOT NULL,
      case_id         TEXT    NOT NULL,
      status          TEXT    NOT NULL CHECK (status IN ('passed','failed','skipped','error')),
      deterministic   INTEGER NOT NULL DEFAULT 0,
      duration_ms     INTEGER,
      failure_class   TEXT,
      result_json     TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_pce_bench_runs_suite ON pce_bench_runs(suite, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pce_bench_runs_status ON pce_bench_runs(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS pce_pattern_proposals (
      id              TEXT    PRIMARY KEY,
      signature_hash  TEXT    NOT NULL,
      pattern_id      TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'proposed'
                              CHECK (status IN ('proposed','testing','promoted','rejected')),
      source_json     TEXT,
      transform_json  TEXT,
      occurrences     INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(signature_hash, pattern_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pce_proposals_status ON pce_pattern_proposals(status, updated_at DESC);
  `);
}
