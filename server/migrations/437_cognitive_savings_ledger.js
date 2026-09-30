// server/migrations/437_cognitive_savings_ledger.js
//
// Per-invocation cognitive savings ledger — DTU → DHTP → model input accounting.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cognitive_savings_ledger (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id                  TEXT,
      step_index                  INTEGER,
      invocation_id               TEXT,
      task_class                  TEXT,
      path                        TEXT,

      context_tokens_full         INTEGER,
      dtu_candidates              INTEGER,
      dtu_selected                INTEGER,
      tokens_after_dtu            INTEGER,
      dhtp_tokens                 INTEGER,
      actual_model_input_tokens   INTEGER,

      dtu_savings                 INTEGER,
      dhtp_savings                INTEGER,
      cache_tokens_avoided        INTEGER,
      pce_tokens_avoided          INTEGER,
      cache_savings               INTEGER,
      pce_savings                 INTEGER,
      total_tokens_avoided        INTEGER,

      compression_ratio           REAL,
      cache_hit                   INTEGER,
      skip_llm                    INTEGER,

      latency_ms                  INTEGER,
      task_success                INTEGER,
      verification_success        INTEGER,

      detail_json                 TEXT,
      created_at                  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_cognitive_savings_mission
      ON cognitive_savings_ledger(mission_id, step_index);
    CREATE INDEX IF NOT EXISTS idx_cognitive_savings_at
      ON cognitive_savings_ledger(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cognitive_savings_path
      ON cognitive_savings_ledger(path, created_at DESC);
  `);

  // Extend dhtp_metrics with aligned savings columns (best-effort).
  const cols = [
    ["context_tokens_full", "INTEGER"],
    ["dtu_candidates", "INTEGER"],
    ["dtu_selected", "INTEGER"],
    ["tokens_after_dtu", "INTEGER"],
    ["actual_model_input_tokens", "INTEGER"],
    ["total_tokens_avoided", "INTEGER"],
  ];
  for (const [col, type] of cols) {
    try {
      db.exec(`ALTER TABLE dhtp_metrics ADD COLUMN ${col} ${type}`);
    } catch { /* column may exist */ }
  }
}
