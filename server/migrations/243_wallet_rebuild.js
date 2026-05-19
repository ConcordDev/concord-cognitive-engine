// server/migrations/243_wallet_rebuild.js
//
// Wallet lens rebuild Sprint A — non-custodial-by-design aggregation
// substrate.
//
// RESEARCH GROUNDING (May 2026):
//   - Money Transmitter License = $30K-$525K per state × 49 states ×
//     6-18 months. Untenable. Concord stays NON-CUSTODIAL by design.
//   - Concord Coin remains internal credit unit (no MTL needed for own
//     currency; same model as airline miles / Stripe credits / Steam
//     wallet). Tracked via existing economy_ledger.
//   - External crypto: WalletConnect / EIP-4337. User keeps keys.
//     credentials_ref stores Plaid public_token or wallet address;
//     NEVER private keys.
//   - Plaid aggregation: read-only bank links. No fund movement = no
//     MTL exposure.
//   - Multi-rail routing: ACH / FedNow / RTP / Same Day ACH; pick
//     fastest at transfer time. Plaid sells this as a product.
//
// Pre-this-migration the wallet domain had 4 macros (budgetCheck,
// portfolioBalance, spendingTrend, transactionCategorize) and NO
// dedicated wallet_* tables. Concord Coin balance reads went through
// economy_ledger directly. This migration adds the aggregation layer.

export function up(db) {
  // wallet_accounts ────────────────────────────────────────────
  // Each row = one externally-linked account the user has connected.
  // credentials_ref is a pointer to a Plaid public_token or wallet
  // address — NEVER stores private keys or secrets.
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_accounts (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT NOT NULL,
      nickname        TEXT NOT NULL,
      kind            TEXT NOT NULL
                      CHECK (kind IN ('concord_coin','bank_checking','bank_savings','credit_card','debit_card','brokerage','crypto_wallet','crypto_exchange','stablecoin_account','digital_wallet','manual')),
      provider        TEXT,                                -- 'plaid','stripe','coinbase','metamask','walletconnect','manual'
      provider_account_id TEXT,                            -- their ID for the account
      institution     TEXT,                                -- 'Chase','Schwab','Coinbase','Ledger',etc.
      account_mask    TEXT,                                -- last 4 digits / address suffix; never the full identifier
      credentials_ref TEXT,                                -- Plaid public_token OR wallet pubkey OR Stripe customer_id. NEVER private keys.
      currency        TEXT NOT NULL DEFAULT 'USD',
      status          TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','disconnected','error','reauth_required','closed')),
      readonly        INTEGER NOT NULL DEFAULT 1,          -- 1 = read-only aggregation; 0 = transactable (rare)
      last_synced_at  INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      removed_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_wacc_owner ON wallet_accounts(owner_user_id, status) WHERE removed_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_wacc_kind ON wallet_accounts(owner_user_id, kind);
  `);

  // wallet_balances_snapshot ──────────────────────────────────
  // Cached aggregated balance per account. Refreshed on demand or by
  // heartbeat. Concord Coin balance is computed live from economy_ledger
  // and cached here for unified-view queries.
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_balances_snapshot (
      account_id      TEXT PRIMARY KEY,
      balance_cents   INTEGER NOT NULL DEFAULT 0,           -- normalized to cents in account currency
      available_cents INTEGER,                              -- if different (e.g. card has cleared vs pending)
      currency        TEXT NOT NULL DEFAULT 'USD',
      as_of           INTEGER NOT NULL DEFAULT (unixepoch()),
      source          TEXT NOT NULL DEFAULT 'cached'
                      CHECK (source IN ('cached','live','provider','reconciled','manual')),
      FOREIGN KEY (account_id) REFERENCES wallet_accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wbs_asof ON wallet_balances_snapshot(as_of DESC);
  `);

  // wallet_transactions ───────────────────────────────────────
  // Unified transaction log across all connected accounts. Each row
  // also keeps source_provider_id so we can dedupe on resync.
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT NOT NULL,
      account_id      TEXT NOT NULL,
      source_provider_id TEXT,                              -- Plaid transaction_id / Stripe charge_id / tx hash / etc
      direction       TEXT NOT NULL
                      CHECK (direction IN ('debit','credit')),
      amount_cents    INTEGER NOT NULL,                     -- always positive; direction tells sign
      currency        TEXT NOT NULL DEFAULT 'USD',
      counterparty    TEXT,                                 -- merchant name, recipient, tx counterparty
      counterparty_kind TEXT
                      CHECK (counterparty_kind IS NULL OR counterparty_kind IN ('merchant','person','self','platform','government','creator','provider')),
      category        TEXT,                                 -- 'food','transport','salary','tip','subscription','transfer','tax'
      subcategory     TEXT,
      memo            TEXT,
      occurred_at     INTEGER NOT NULL,
      posted_at       INTEGER,
      status          TEXT NOT NULL DEFAULT 'posted'
                      CHECK (status IN ('pending','posted','reversed','disputed','voided')),
      is_recurring    INTEGER NOT NULL DEFAULT 0,
      recurring_id    TEXT,                                 -- back-ref to wallet_recurring if detected
      receipt_dtu_id  TEXT,                                 -- set when minted as a receipt DTU (Sprint C)
      meta_json       TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (account_id) REFERENCES wallet_accounts(id) ON DELETE CASCADE,
      UNIQUE(account_id, source_provider_id)
    );
    CREATE INDEX IF NOT EXISTS idx_wtx_owner_date ON wallet_transactions(owner_user_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wtx_account_date ON wallet_transactions(account_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wtx_category ON wallet_transactions(owner_user_id, category, occurred_at DESC) WHERE category IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_wtx_recurring ON wallet_transactions(recurring_id) WHERE recurring_id IS NOT NULL;
  `);

  // wallet_recurring ──────────────────────────────────────────
  // Subscriptions + recurring charges discovered or manually added.
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_recurring (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT NOT NULL,
      counterparty    TEXT NOT NULL,
      typical_amount_cents INTEGER NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'USD',
      cadence         TEXT NOT NULL
                      CHECK (cadence IN ('weekly','biweekly','monthly','quarterly','annually','custom')),
      category        TEXT,
      next_expected_at INTEGER,
      last_charged_at INTEGER,
      charge_count    INTEGER NOT NULL DEFAULT 0,
      total_paid_cents INTEGER NOT NULL DEFAULT 0,
      active          INTEGER NOT NULL DEFAULT 1,
      source          TEXT NOT NULL DEFAULT 'detected'
                      CHECK (source IN ('detected','manual','imported')),
      cancellation_url TEXT,                                -- if known (Subscription Tracker pattern)
      notes           TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      cancelled_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_wrec_owner ON wallet_recurring(owner_user_id, active, next_expected_at);
  `);

  // wallet_categories ─────────────────────────────────────────
  // User-editable category taxonomy. Seeded with the standard
  // personal-finance categories (Plaid + Mint + YNAB convention).
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_categories (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT,                                 -- null = system defaults
      key             TEXT NOT NULL,                        -- 'food.groceries','transport.transit'
      label           TEXT NOT NULL,
      icon            TEXT,
      color           TEXT,
      kind            TEXT NOT NULL DEFAULT 'expense'
                      CHECK (kind IN ('expense','income','transfer','investment','tax','tip')),
      budget_monthly_cents INTEGER,                         -- optional budget cap
      parent_key      TEXT,                                 -- hierarchical
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(owner_user_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_wcat_owner ON wallet_categories(owner_user_id, kind);

    -- Seed system defaults (owner_user_id = NULL)
    INSERT OR IGNORE INTO wallet_categories (id, owner_user_id, key, label, icon, kind) VALUES
      ('wcat:sys:food',         NULL, 'food',         'Food & Drink',    '🍽️', 'expense'),
      ('wcat:sys:groceries',    NULL, 'food.groceries', 'Groceries',     '🛒', 'expense'),
      ('wcat:sys:restaurants',  NULL, 'food.restaurants', 'Restaurants', '🍴', 'expense'),
      ('wcat:sys:transport',    NULL, 'transport',    'Transportation',  '🚗', 'expense'),
      ('wcat:sys:fuel',         NULL, 'transport.fuel', 'Fuel',          '⛽', 'expense'),
      ('wcat:sys:transit',      NULL, 'transport.transit', 'Transit',    '🚆', 'expense'),
      ('wcat:sys:housing',      NULL, 'housing',      'Housing',         '🏠', 'expense'),
      ('wcat:sys:rent',         NULL, 'housing.rent', 'Rent',            '🏠', 'expense'),
      ('wcat:sys:mortgage',     NULL, 'housing.mortgage', 'Mortgage',    '🏠', 'expense'),
      ('wcat:sys:utilities',    NULL, 'housing.utilities', 'Utilities',  '💡', 'expense'),
      ('wcat:sys:health',       NULL, 'health',       'Healthcare',      '🩺', 'expense'),
      ('wcat:sys:insurance',    NULL, 'insurance',    'Insurance',       '🛡️', 'expense'),
      ('wcat:sys:subscriptions',NULL, 'subscriptions','Subscriptions',   '🔁', 'expense'),
      ('wcat:sys:shopping',     NULL, 'shopping',     'Shopping',        '🛍️', 'expense'),
      ('wcat:sys:entertain',    NULL, 'entertainment','Entertainment',   '🎬', 'expense'),
      ('wcat:sys:travel',       NULL, 'travel',       'Travel',          '✈️', 'expense'),
      ('wcat:sys:education',    NULL, 'education',    'Education',       '📚', 'expense'),
      ('wcat:sys:tax',          NULL, 'tax',          'Taxes',           '🏛️', 'tax'),
      ('wcat:sys:tip',          NULL, 'tip',          'Tips & Donations','💸', 'tip'),
      ('wcat:sys:salary',       NULL, 'income.salary','Salary',          '💼', 'income'),
      ('wcat:sys:freelance',    NULL, 'income.freelance', 'Freelance',   '🧑‍💻', 'income'),
      ('wcat:sys:creator',      NULL, 'income.creator', 'Creator income','🎨', 'income'),
      ('wcat:sys:dividend',     NULL, 'income.dividend', 'Dividends',    '📈', 'income'),
      ('wcat:sys:interest',     NULL, 'income.interest', 'Interest',     '💰', 'income'),
      ('wcat:sys:transfer',     NULL, 'transfer',     'Internal transfer', '↔️', 'transfer'),
      ('wcat:sys:investment',   NULL, 'investment',   'Investment',      '📊', 'investment'),
      ('wcat:sys:concord_coin', NULL, 'concord_coin', 'Concord Coin activity', '🪙', 'expense');
  `);

  // wallet_rails_config ───────────────────────────────────────
  // Per-user preferences for multi-rail routing. When transferring,
  // pick fastest by default but allow override (some users prefer
  // free ACH over instant fee'd FedNow).
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_rails_config (
      owner_user_id   TEXT PRIMARY KEY,
      prefer_speed_over_cost INTEGER NOT NULL DEFAULT 1,    -- 1 = fastest by default
      max_ach_fee_cents INTEGER NOT NULL DEFAULT 25,        -- e.g. willing to pay $0.25 max
      max_fednow_fee_cents INTEGER NOT NULL DEFAULT 100,
      max_rtp_fee_cents INTEGER NOT NULL DEFAULT 100,
      allow_concord_coin_first INTEGER NOT NULL DEFAULT 1,  -- prefer internal currency when possible
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS wallet_rails_config;
    DROP TABLE IF EXISTS wallet_categories;
    DROP TABLE IF EXISTS wallet_recurring;
    DROP TABLE IF EXISTS wallet_transactions;
    DROP TABLE IF EXISTS wallet_balances_snapshot;
    DROP TABLE IF EXISTS wallet_accounts;
  `);
}
