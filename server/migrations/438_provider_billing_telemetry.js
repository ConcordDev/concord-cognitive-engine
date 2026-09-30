// server/migrations/438_provider_billing_telemetry.js
//
// Real provider billing telemetry — prompt/completion/cached tokens + billed USD.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_billing_telemetry (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      invocation_id         TEXT NOT NULL,
      mission_id            TEXT,
      step_index            INTEGER,
      path                  TEXT,
      model                 TEXT,
      provider              TEXT,
      prompt_tokens         INTEGER NOT NULL DEFAULT 0,
      completion_tokens     INTEGER NOT NULL DEFAULT 0,
      cached_prompt_tokens  INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens      INTEGER NOT NULL DEFAULT 0,
      input_usd             REAL NOT NULL DEFAULT 0,
      output_usd            REAL NOT NULL DEFAULT 0,
      total_usd             REAL NOT NULL DEFAULT 0,
      latency_ms            INTEGER,
      billing_source        TEXT NOT NULL DEFAULT 'provider',
      detail_json           TEXT,
      created_at            INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_provider_billing_mission
      ON provider_billing_telemetry(mission_id, step_index);
    CREATE INDEX IF NOT EXISTS idx_provider_billing_path
      ON provider_billing_telemetry(path, created_at DESC);

    CREATE TABLE IF NOT EXISTS dhtp_counterfactual_tests (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id               TEXT NOT NULL,
      field                 TEXT,
      task_class            TEXT,
      full_tokens           INTEGER,
      compressed_tokens     INTEGER,
      quality_full          REAL,
      quality_compressed      REAL,
      quality_delta         REAL,
      token_savings_pct     REAL,
      promoted              INTEGER NOT NULL DEFAULT 0,
      rejected              INTEGER NOT NULL DEFAULT 0,
      reason                TEXT,
      detail_json           TEXT,
      created_at            INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_dhtp_counterfactual_rule
      ON dhtp_counterfactual_tests(rule_id, created_at DESC);
  `);
}
