// server/migrations/435_dhtp_metrics.js
//
// DHTP compression metrics — optimize minimum tokens with success + recoverability.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dhtp_metrics (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id          TEXT,
      step_index          INTEGER,
      task_class          TEXT,
      full_context_tokens INTEGER,
      dhtp_tokens         INTEGER,
      tokens_saved        INTEGER,
      task_success        INTEGER,
      verification_success INTEGER,
      latency_ms          INTEGER,
      cache_hit           INTEGER,
      recovery_required   INTEGER,
      compression_ratio   REAL,
      preset_id           TEXT,
      path                TEXT,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_dhtp_metrics_at ON dhtp_metrics(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dhtp_metrics_mission ON dhtp_metrics(mission_id, step_index);
  `);
}
