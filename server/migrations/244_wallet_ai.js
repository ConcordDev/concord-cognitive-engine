// server/migrations/244_wallet_ai.js
//
// Wallet lens Sprint B — AI surface substrate.
//
// RESEARCH GROUNDING (May 2026):
//   - Copilot Money ~93% first-pass categorization via private per-user ML.
//     Concord matches via rule → deterministic → LLM cascade + feedback loop.
//   - Monarch Money 80%+ behavioral accuracy after 10-14 days + 20+ tagged
//     transactions. Subscription auto-discovery is standard. Cash flow
//     prediction is the 2026 differentiator.
//   - Every AI invocation logged with prompt + model + tokens (same
//     provenance pattern as healthcare/social/accounting AI ledgers).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_categorization_rules (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT NOT NULL,
      pattern         TEXT NOT NULL,
      pattern_kind    TEXT NOT NULL DEFAULT 'substring'
                      CHECK (pattern_kind IN ('substring','regex','counterparty','amount_range')),
      target_category TEXT NOT NULL,
      target_subcategory TEXT,
      priority        INTEGER NOT NULL DEFAULT 100,
      hit_count       INTEGER NOT NULL DEFAULT 0,
      source          TEXT NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('manual','llm_suggested','learned','imported')),
      enabled         INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      last_hit_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_wcr_owner ON wallet_categorization_rules(owner_user_id, enabled, priority DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_anomalies (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT NOT NULL,
      kind            TEXT NOT NULL
                      CHECK (kind IN ('spending_spike','duplicate_charge','benford_violation','sudden_subscription','unusual_counterparty','overdraft_risk','round_number_cluster','large_unusual_charge')),
      severity        TEXT NOT NULL DEFAULT 'medium'
                      CHECK (severity IN ('low','medium','high','critical')),
      subject_kind    TEXT,
      subject_id      TEXT,
      detail_json     TEXT,
      detected_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      acknowledged_at INTEGER,
      acknowledged_by TEXT,
      resolution_note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wanom_owner ON wallet_anomalies(owner_user_id, detected_at DESC) WHERE acknowledged_at IS NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_subscription_predictions (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT NOT NULL,
      counterparty    TEXT NOT NULL,
      typical_amount_cents INTEGER NOT NULL,
      cadence         TEXT NOT NULL
                      CHECK (cadence IN ('weekly','biweekly','monthly','quarterly','annually')),
      confidence      REAL NOT NULL DEFAULT 0.5,
      sample_count    INTEGER NOT NULL DEFAULT 0,
      first_seen_at   INTEGER,
      last_seen_at    INTEGER,
      registered_recurring_id TEXT,
      dismissed       INTEGER NOT NULL DEFAULT 0,
      detected_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_wsp_owner ON wallet_subscription_predictions(owner_user_id, dismissed, confidence DESC) WHERE dismissed = 0;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_cashflow_forecasts (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT NOT NULL,
      horizon_days    INTEGER NOT NULL,
      projected_income_cents INTEGER NOT NULL DEFAULT 0,
      projected_spend_cents INTEGER NOT NULL DEFAULT 0,
      projected_net_cents INTEGER NOT NULL DEFAULT 0,
      ending_balance_cents INTEGER,
      breakdown_json  TEXT,
      methodology     TEXT NOT NULL DEFAULT 'deterministic'
                      CHECK (methodology IN ('deterministic','llm','hybrid')),
      composed_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_wcf_owner ON wallet_cashflow_forecasts(owner_user_id, composed_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_ai_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id   TEXT NOT NULL,
      kind            TEXT NOT NULL
                      CHECK (kind IN ('categorize','anomaly_scan','subscription_discover','cashflow_forecast','tax_summary','narrative')),
      prompt_text     TEXT,
      model_name      TEXT,
      output_text     TEXT,
      source          TEXT NOT NULL DEFAULT 'llm'
                      CHECK (source IN ('llm','fallback','deterministic','rule')),
      tokens          INTEGER NOT NULL DEFAULT 0,
      latency_ms      INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_wair_owner ON wallet_ai_runs(owner_user_id, created_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS wallet_ai_runs;
    DROP TABLE IF EXISTS wallet_cashflow_forecasts;
    DROP TABLE IF EXISTS wallet_subscription_predictions;
    DROP TABLE IF EXISTS wallet_anomalies;
    DROP TABLE IF EXISTS wallet_categorization_rules;
  `);
}
