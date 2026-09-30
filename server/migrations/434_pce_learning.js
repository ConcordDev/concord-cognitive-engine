// server/migrations/434_pce_learning.js
//
// Learning pipeline — regression baselines, validation runs, learning audit trail.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pce_regression_baselines (
      case_id         TEXT    PRIMARY KEY,
      suite           TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'baseline' CHECK (status IN ('baseline','flaky','retired')),
      last_passed_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      pass_count      INTEGER NOT NULL DEFAULT 1,
      meta_json       TEXT
    );

    CREATE TABLE IF NOT EXISTS pce_pattern_validations (
      id              TEXT    PRIMARY KEY,
      pattern_id      TEXT    NOT NULL,
      status          TEXT    NOT NULL CHECK (status IN ('passed','failed','blocked')),
      regression_pass INTEGER NOT NULL DEFAULT 0,
      regression_fail INTEGER NOT NULL DEFAULT 0,
      blocked_reason  TEXT,
      result_json     TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_pce_validations_pattern ON pce_pattern_validations(pattern_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS pce_learning_events (
      id              TEXT    PRIMARY KEY,
      case_id         TEXT,
      signature_hash  TEXT,
      pattern_id      TEXT,
      stage           TEXT    NOT NULL CHECK (stage IN (
        'failure','signature','proposed','validated','promoted','rejected','demoted'
      )),
      failure_class   TEXT,
      deterministic   INTEGER,
      llm_required    INTEGER,
      meta_json       TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_pce_learning_stage ON pce_learning_events(stage, created_at DESC);

    CREATE TABLE IF NOT EXISTS pce_excellence_runs (
      id              TEXT    PRIMARY KEY,
      pass_rate       REAL,
      deterministic_coverage REAL,
      llm_fallback_rate REAL,
      total_cases     INTEGER,
      passed          INTEGER,
      failed          INTEGER,
      promoted        INTEGER NOT NULL DEFAULT 0,
      rejected        INTEGER NOT NULL DEFAULT 0,
      delta_pass_rate REAL,
      result_json     TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_pce_excellence_runs_at ON pce_excellence_runs(created_at DESC);
  `);
}
