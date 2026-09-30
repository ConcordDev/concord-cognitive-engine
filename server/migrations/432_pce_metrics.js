// server/migrations/432_pce_metrics.js
//
// PCEBench — empirical metrics for autonomous coding missions.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pce_metrics (
      id              TEXT    PRIMARY KEY,
      mission_id      TEXT,
      category        TEXT    NOT NULL,
      path            TEXT    NOT NULL CHECK (path IN ('deterministic','llm','failed','hybrid')),
      ok              INTEGER NOT NULL DEFAULT 0,
      deterministic   INTEGER NOT NULL DEFAULT 0,
      duration_ms     INTEGER,
      files_changed   INTEGER NOT NULL DEFAULT 0,
      tests_passed    INTEGER,
      quality_score   REAL,
      tokens_used     INTEGER,
      human_intervention INTEGER NOT NULL DEFAULT 0,
      recovery_attempts INTEGER NOT NULL DEFAULT 0,
      regression      INTEGER NOT NULL DEFAULT 0,
      meta_json       TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_pce_metrics_category ON pce_metrics(category, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pce_metrics_mission ON pce_metrics(mission_id, created_at DESC);
  `);
}
