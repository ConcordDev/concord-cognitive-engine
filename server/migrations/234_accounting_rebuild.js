// server/migrations/234_accounting_rebuild.js
//
// Accounting lens rebuild Sprint A — durable persistence for the
// double-entry bookkeeping substrate. Pre-this-migration the existing
// accounting domain stored everything in STATE.accountingLens which
// rode the state_snapshots blob; this migration moves it into
// proper relational tables so:
//   - queries scale (chart of accounts can be 100s, not in a Map)
//   - transactions get true ACID semantics for journal posting
//   - audit-trail DTUs reference real rows
//   - multi-entity accounting becomes possible (entity_id column)
//
// Mirrors the existing STATE.accountingLens shape:
//   coa:      Map<userId, Map<accountId, {id, code, name, type, normal, ...}>>
//   journal:  Map<userId, [{id, date, memo, status, lines:[{accountId, debit, credit}]}]>
//   invoices: Map<userId, [{id, customerId, customerName, total, status, ...}]>
//
// + adds entity scoping (so a user can have a personal entity + multiple
// business entities) and budget tracking.

export function up(db) {
  // accounting_entities ─────────────────────────────────────────
  // Multi-entity scoping. Every user gets a default entity on first
  // CoA insert. Org / corp / household are separate entities so books
  // don't bleed across.
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_entities (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT NOT NULL,
      name            TEXT NOT NULL,
      kind            TEXT NOT NULL DEFAULT 'personal'
                      CHECK (kind IN ('personal','sole_prop','llc','corp','non_profit','household','project')),
      base_currency   TEXT NOT NULL DEFAULT 'concord_coin',
      tax_id          TEXT,
      fiscal_year_start_month INTEGER NOT NULL DEFAULT 1
                      CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      archived_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_acc_entity_owner ON accounting_entities(owner_user_id, archived_at);
  `);

  // accounting_coa ───────────────────────────────────────────────
  // Chart of Accounts. GAAP-aligned category enum + normal-balance
  // hint. code is the user-visible account number (e.g. "1010" for
  // Cash). UNIQUE per (entity_id, code) so accounts don't collide.
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_coa (
      id              TEXT PRIMARY KEY,
      entity_id       TEXT NOT NULL,
      code            TEXT NOT NULL,
      name            TEXT NOT NULL,
      type            TEXT NOT NULL
                      CHECK (type IN ('asset','liability','equity','revenue','expense','contra_asset','contra_liability','contra_revenue')),
      normal_balance  TEXT NOT NULL CHECK (normal_balance IN ('debit','credit')),
      parent_account_id TEXT,                              -- for sub-accounts (Cash > Operating > Checking)
      tax_category    TEXT,                                -- maps to tax form line item
      is_active       INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      archived_at     INTEGER,
      UNIQUE(entity_id, code),
      FOREIGN KEY (entity_id) REFERENCES accounting_entities(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_coa_entity ON accounting_coa(entity_id, type, is_active);
    CREATE INDEX IF NOT EXISTS idx_coa_parent ON accounting_coa(parent_account_id) WHERE parent_account_id IS NOT NULL;
  `);

  // accounting_journal_entries ────────────────────────────────────
  // The header row for a posted JE. status tracks draft/posted/voided
  // so reversals leave an audit trail.
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_journal_entries (
      id              TEXT PRIMARY KEY,
      entity_id       TEXT NOT NULL,
      number          TEXT NOT NULL,                       -- JE-00001, JE-00002, ... (per-entity sequence)
      date            TEXT NOT NULL,                       -- ISO date (YYYY-MM-DD)
      memo            TEXT,
      status          TEXT NOT NULL DEFAULT 'posted'
                      CHECK (status IN ('draft','posted','voided')),
      source          TEXT,                                -- 'manual', 'invoice:abc', 'payment:xyz', 'reconcile:Q3'
      reverses_je_id  TEXT,                                -- when this JE voids another
      posted_by       TEXT NOT NULL,
      posted_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      voided_at       INTEGER,
      voided_by       TEXT,
      meta_json       TEXT,
      FOREIGN KEY (entity_id) REFERENCES accounting_entities(id) ON DELETE CASCADE,
      UNIQUE(entity_id, number)
    );
    CREATE INDEX IF NOT EXISTS idx_je_entity_date ON accounting_journal_entries(entity_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_je_status ON accounting_journal_entries(entity_id, status);
    CREATE INDEX IF NOT EXISTS idx_je_source ON accounting_journal_entries(source) WHERE source IS NOT NULL;
  `);

  // accounting_journal_lines ──────────────────────────────────────
  // One row per debit/credit. The double-entry invariant (sum of debits
  // = sum of credits per JE) is enforced at the persistence-helper
  // level inside a transaction. CHECK constraint enforces that any
  // given line is purely debit OR credit (not both).
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_journal_lines (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      journal_entry_id TEXT NOT NULL,
      line_no         INTEGER NOT NULL,
      account_id      TEXT NOT NULL,
      debit           REAL NOT NULL DEFAULT 0,
      credit          REAL NOT NULL DEFAULT 0,
      memo            TEXT,
      CHECK ((debit = 0) <> (credit = 0)),                 -- exactly one side nonzero
      CHECK (debit >= 0 AND credit >= 0),
      FOREIGN KEY (journal_entry_id) REFERENCES accounting_journal_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounting_coa(id) ON DELETE RESTRICT,
      UNIQUE(journal_entry_id, line_no)
    );
    CREATE INDEX IF NOT EXISTS idx_jl_je ON accounting_journal_lines(journal_entry_id, line_no);
    CREATE INDEX IF NOT EXISTS idx_jl_account ON accounting_journal_lines(account_id);
  `);

  // accounting_invoices ───────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_invoices (
      id              TEXT PRIMARY KEY,
      entity_id       TEXT NOT NULL,
      number          TEXT NOT NULL,                       -- INV-00001, INV-00002, ...
      customer_id     TEXT,
      customer_name   TEXT NOT NULL,
      customer_email  TEXT,
      issued_date     TEXT NOT NULL,                       -- ISO date
      due_date        TEXT NOT NULL,                       -- ISO date
      currency        TEXT NOT NULL DEFAULT 'concord_coin',
      subtotal        REAL NOT NULL DEFAULT 0,
      tax_total       REAL NOT NULL DEFAULT 0,
      total           REAL NOT NULL DEFAULT 0,
      amount_paid     REAL NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','sent','partial','paid','overdue','voided','refunded')),
      payment_link_url TEXT,
      stripe_payment_intent_id TEXT,
      notes           TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      sent_at         INTEGER,
      paid_at         INTEGER,
      voided_at       INTEGER,
      FOREIGN KEY (entity_id) REFERENCES accounting_entities(id) ON DELETE CASCADE,
      UNIQUE(entity_id, number)
    );
    CREATE INDEX IF NOT EXISTS idx_inv_entity_status ON accounting_invoices(entity_id, status, issued_date DESC);
    CREATE INDEX IF NOT EXISTS idx_inv_due ON accounting_invoices(due_date) WHERE status IN ('sent','partial','overdue');
    CREATE INDEX IF NOT EXISTS idx_inv_customer ON accounting_invoices(customer_id, status) WHERE customer_id IS NOT NULL;
  `);

  // accounting_invoice_lines ──────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_invoice_lines (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id      TEXT NOT NULL,
      line_no         INTEGER NOT NULL,
      description     TEXT NOT NULL,
      quantity        REAL NOT NULL DEFAULT 1,
      unit_price      REAL NOT NULL DEFAULT 0,
      tax_rate        REAL NOT NULL DEFAULT 0,             -- 0.0825 for 8.25%
      line_total      REAL NOT NULL DEFAULT 0,
      revenue_account_id TEXT,                             -- defaults to entity's default revenue account
      tax_account_id  TEXT,
      FOREIGN KEY (invoice_id) REFERENCES accounting_invoices(id) ON DELETE CASCADE,
      UNIQUE(invoice_id, line_no)
    );
    CREATE INDEX IF NOT EXISTS idx_il_invoice ON accounting_invoice_lines(invoice_id, line_no);
  `);

  // accounting_payments ───────────────────────────────────────────
  // One row per inbound or outbound payment. Inbound (customer pays
  // an invoice) flows through invoice.amount_paid + creates a JE.
  // Outbound (paying a bill) is independent of invoices.
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_payments (
      id              TEXT PRIMARY KEY,
      entity_id       TEXT NOT NULL,
      kind            TEXT NOT NULL
                      CHECK (kind IN ('inbound','outbound','transfer','adjustment')),
      invoice_id      TEXT,                                -- when inbound payment against an invoice
      amount          REAL NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'concord_coin',
      method          TEXT,                                -- 'cash','check','stripe','wire','concord_coin'
      reference       TEXT,                                -- check#, transaction id, etc.
      memo            TEXT,
      occurred_at     TEXT NOT NULL,                       -- ISO datetime
      journal_entry_id TEXT,                               -- the JE this payment posted
      recorded_by     TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (entity_id) REFERENCES accounting_entities(id) ON DELETE CASCADE,
      FOREIGN KEY (invoice_id) REFERENCES accounting_invoices(id) ON DELETE SET NULL,
      FOREIGN KEY (journal_entry_id) REFERENCES accounting_journal_entries(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pay_entity_date ON accounting_payments(entity_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pay_invoice ON accounting_payments(invoice_id) WHERE invoice_id IS NOT NULL;
  `);

  // accounting_budgets ────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_budgets (
      id              TEXT PRIMARY KEY,
      entity_id       TEXT NOT NULL,
      name            TEXT NOT NULL,
      period_start    TEXT NOT NULL,                       -- ISO date
      period_end      TEXT NOT NULL,
      created_by      TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      archived_at     INTEGER,
      FOREIGN KEY (entity_id) REFERENCES accounting_entities(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_budget_entity ON accounting_budgets(entity_id, period_start) WHERE archived_at IS NULL;

    CREATE TABLE IF NOT EXISTS accounting_budget_lines (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      budget_id       TEXT NOT NULL,
      account_id      TEXT NOT NULL,
      amount          REAL NOT NULL,                       -- planned for the period
      notes           TEXT,
      FOREIGN KEY (budget_id) REFERENCES accounting_budgets(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounting_coa(id) ON DELETE CASCADE,
      UNIQUE(budget_id, account_id)
    );
  `);

  // accounting_sequences ──────────────────────────────────────────
  // Per-entity number generators so JE/INV codes don't collide.
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_sequences (
      entity_id       TEXT NOT NULL,
      kind            TEXT NOT NULL CHECK (kind IN ('journal','invoice','payment','budget')),
      next_value      INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (entity_id, kind)
    );
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS accounting_sequences;
    DROP TABLE IF EXISTS accounting_budget_lines;
    DROP TABLE IF EXISTS accounting_budgets;
    DROP TABLE IF EXISTS accounting_payments;
    DROP TABLE IF EXISTS accounting_invoice_lines;
    DROP TABLE IF EXISTS accounting_invoices;
    DROP TABLE IF EXISTS accounting_journal_lines;
    DROP TABLE IF EXISTS accounting_journal_entries;
    DROP TABLE IF EXISTS accounting_coa;
    DROP TABLE IF EXISTS accounting_entities;
  `);
}
