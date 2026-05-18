// server/migrations/236_accounting_moats.js
//
// Accounting lens rebuild Sprint C — concord-native moats:
//
//   accounting_statement_mints      — when financial reports (P&L, balance sheet, etc) get minted as DTUs
//   accounting_template_mints       — when CoA / budget templates get minted as DTUs (marketplace)
//   accounting_consolidations       — multi-entity consolidation runs (parent + subs)
//   accounting_audit_trail_dtus     — immutable audit-trail DTUs (CLAUDE.md feature: "Audit Trail DTUs")

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_statement_mints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id       TEXT NOT NULL,
      statement_kind  TEXT NOT NULL
                      CHECK (statement_kind IN ('trial_balance','balance_sheet','profit_loss','invoice_aging','cash_flow','tax_summary')),
      period_start    TEXT,
      period_end      TEXT,
      dtu_id          TEXT NOT NULL UNIQUE,
      creator_id      TEXT NOT NULL,
      royalty_rate    REAL NOT NULL DEFAULT 0.21,
      visibility      TEXT NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      allow_citation  INTEGER NOT NULL DEFAULT 1,
      citation_count  INTEGER NOT NULL DEFAULT 0,
      minted_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (entity_id) REFERENCES accounting_entities(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_acc_stmnt_entity ON accounting_statement_mints(entity_id, minted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_acc_stmnt_creator ON accounting_statement_mints(creator_id, minted_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_template_mints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      kind            TEXT NOT NULL
                      CHECK (kind IN ('coa_template','budget_template','tax_template','rule_pack')),
      title           TEXT NOT NULL,
      description     TEXT,
      payload_json    TEXT NOT NULL,                       -- the template body (e.g. array of CoA entries)
      dtu_id          TEXT NOT NULL UNIQUE,
      creator_id      TEXT NOT NULL,
      royalty_rate    REAL NOT NULL DEFAULT 0.21,
      visibility      TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      install_count   INTEGER NOT NULL DEFAULT 0,
      minted_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_acc_tmpl_creator ON accounting_template_mints(creator_id, minted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_acc_tmpl_kind ON accounting_template_mints(kind, install_count DESC) WHERE visibility IN ('public','published','global');
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_template_installs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      template_mint_id INTEGER NOT NULL,
      installer_id    TEXT NOT NULL,
      target_entity_id TEXT NOT NULL,
      installed_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (template_mint_id) REFERENCES accounting_template_mints(id) ON DELETE CASCADE,
      FOREIGN KEY (target_entity_id) REFERENCES accounting_entities(id) ON DELETE CASCADE,
      UNIQUE(template_mint_id, target_entity_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_consolidations (
      id              TEXT PRIMARY KEY,
      parent_entity_id TEXT NOT NULL,
      child_entity_ids_json TEXT NOT NULL,                 -- array of entity IDs to roll up
      period_start    TEXT NOT NULL,
      period_end      TEXT NOT NULL,
      eliminations_json TEXT,                              -- intercompany eliminations
      result_json     TEXT NOT NULL,                       -- the consolidated statement
      created_by      TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_acc_cons_parent ON accounting_consolidations(parent_entity_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_audit_trail_dtus (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id       TEXT NOT NULL,
      event_kind      TEXT NOT NULL                        -- 'je_posted', 'je_voided', 'invoice_paid', 'account_archived', 'consolidation_run', 'period_locked'
                      CHECK (event_kind IN ('je_posted','je_voided','invoice_paid','account_archived','consolidation_run','period_locked','template_installed')),
      subject_id      TEXT,
      dtu_id          TEXT NOT NULL UNIQUE,
      hash_chain      TEXT,                                -- SHA-256 of prev_hash + this row content
      actor_id        TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (entity_id) REFERENCES accounting_entities(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_acc_audit_entity ON accounting_audit_trail_dtus(entity_id, created_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS accounting_audit_trail_dtus;
    DROP TABLE IF EXISTS accounting_consolidations;
    DROP TABLE IF EXISTS accounting_template_installs;
    DROP TABLE IF EXISTS accounting_template_mints;
    DROP TABLE IF EXISTS accounting_statement_mints;
  `);
}
