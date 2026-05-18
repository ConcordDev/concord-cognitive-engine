// server/migrations/235_accounting_ai.js
//
// Accounting lens rebuild Sprint B — AI surface substrate.
//
//   accounting_categorization_rules — auto-categorization rule book
//   accounting_anomalies            — detected anomalies (per period)
//   accounting_ai_narratives        — LLM-generated P&L / BS / variance prose
//   accounting_ai_runs              — ledger of every AI invocation
//   accounting_receipt_extractions  — LLaVA-extracted line items from receipts

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_categorization_rules (
      id              TEXT PRIMARY KEY,
      entity_id       TEXT NOT NULL,
      pattern         TEXT NOT NULL,                       -- regex or substring match against memo / vendor
      pattern_kind    TEXT NOT NULL DEFAULT 'substring'
                      CHECK (pattern_kind IN ('substring','regex','vendor','amount_range','llm')),
      target_account_id TEXT NOT NULL,
      priority        INTEGER NOT NULL DEFAULT 100,
      hit_count       INTEGER NOT NULL DEFAULT 0,
      created_by      TEXT NOT NULL,
      source          TEXT NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('manual','llm_suggested','imported','learned')),
      enabled         INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      last_hit_at     INTEGER,
      FOREIGN KEY (entity_id) REFERENCES accounting_entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_account_id) REFERENCES accounting_coa(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_acr_entity ON accounting_categorization_rules(entity_id, enabled, priority DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_anomalies (
      id              TEXT PRIMARY KEY,
      entity_id       TEXT NOT NULL,
      kind            TEXT NOT NULL                        -- 'unbalanced_period', 'benford_violation', 'spike', 'round_number_cluster', 'duplicate_invoice', 'orphan_payment', 'negative_equity'
                      CHECK (kind IN ('unbalanced_period','benford_violation','spike','round_number_cluster','duplicate_invoice','orphan_payment','negative_equity','category_drift')),
      severity        TEXT NOT NULL DEFAULT 'medium'
                      CHECK (severity IN ('low','medium','high','critical')),
      period_start    TEXT,
      period_end      TEXT,
      subject_kind    TEXT,                                -- 'account', 'invoice', 'journal_entry', 'period'
      subject_id      TEXT,
      detail_json     TEXT,                                -- { account, expected, actual, score, ... }
      detected_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      acknowledged_at INTEGER,
      acknowledged_by TEXT,
      resolution_note TEXT,
      FOREIGN KEY (entity_id) REFERENCES accounting_entities(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_anom_entity ON accounting_anomalies(entity_id, detected_at DESC) WHERE acknowledged_at IS NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_ai_narratives (
      id              TEXT PRIMARY KEY,
      entity_id       TEXT NOT NULL,
      kind            TEXT NOT NULL                        -- 'profit_loss', 'balance_sheet', 'variance', 'cashflow', 'tax_summary', 'audit_summary'
                      CHECK (kind IN ('profit_loss','balance_sheet','variance','cashflow','tax_summary','audit_summary')),
      period_start    TEXT,
      period_end      TEXT,
      narrative       TEXT NOT NULL,                       -- the prose
      bullets_json    TEXT,                                -- structured highlights
      tone            TEXT NOT NULL DEFAULT 'plain'
                      CHECK (tone IN ('plain','executive','accountant','tax','founder')),
      source          TEXT NOT NULL DEFAULT 'llm'
                      CHECK (source IN ('llm','fallback','deterministic','human')),
      tokens          INTEGER NOT NULL DEFAULT 0,
      composed_by     TEXT NOT NULL,
      composed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (entity_id) REFERENCES accounting_entities(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_narr_entity ON accounting_ai_narratives(entity_id, kind, composed_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_ai_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id       TEXT,
      user_id         TEXT,
      kind            TEXT NOT NULL                        -- 'categorize', 'anomaly_scan', 'narrative', 'receipt_extract', 'tax_summary'
                      CHECK (kind IN ('categorize','anomaly_scan','narrative','receipt_extract','tax_summary')),
      input_summary   TEXT,
      output_summary  TEXT,
      source          TEXT NOT NULL DEFAULT 'llm'
                      CHECK (source IN ('llm','fallback','deterministic','vision')),
      tokens          INTEGER NOT NULL DEFAULT 0,
      latency_ms      INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_acc_air ON accounting_ai_runs(entity_id, created_at DESC) WHERE entity_id IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_receipt_extractions (
      id              TEXT PRIMARY KEY,
      entity_id       TEXT NOT NULL,
      uploader_id     TEXT NOT NULL,
      source_kind     TEXT NOT NULL DEFAULT 'image'
                      CHECK (source_kind IN ('image','pdf','email','manual')),
      source_uri      TEXT,
      vendor_name     TEXT,
      total           REAL,
      tax_amount      REAL,
      currency        TEXT NOT NULL DEFAULT 'concord_coin',
      receipt_date    TEXT,                                -- ISO date parsed from receipt
      line_items_json TEXT NOT NULL DEFAULT '[]',          -- [{description, quantity, unit_price, total}]
      suggested_account_id TEXT,                           -- LLaVA / categorization brain pick
      confidence      REAL NOT NULL DEFAULT 0.5,
      journal_entry_id TEXT,                               -- set once converted to a posted JE
      source          TEXT NOT NULL DEFAULT 'vision'
                      CHECK (source IN ('vision','fallback','manual')),
      extracted_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      converted_at    INTEGER,
      FOREIGN KEY (entity_id) REFERENCES accounting_entities(id) ON DELETE CASCADE,
      FOREIGN KEY (journal_entry_id) REFERENCES accounting_journal_entries(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_re_entity ON accounting_receipt_extractions(entity_id, extracted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_re_unconverted ON accounting_receipt_extractions(entity_id) WHERE journal_entry_id IS NULL;
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS accounting_receipt_extractions;
    DROP TABLE IF EXISTS accounting_ai_runs;
    DROP TABLE IF EXISTS accounting_ai_narratives;
    DROP TABLE IF EXISTS accounting_anomalies;
    DROP TABLE IF EXISTS accounting_categorization_rules;
  `);
}
