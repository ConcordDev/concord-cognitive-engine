// server/migrations/296_reward_ledger.js
//
// Lightweight reward/activity ledger.
//
// Six best-effort "audit row" INSERTs (achievement-engine, auctions debit+credit,
// player-mail debit+credit, weekly-objectives) write to `economy_ledger` with a
// simplified shape — (id, user_id, kind, amount_cc, ts, ref_id) — and custom kinds
// like 'achievement_credit' / 'auction_debit' / 'mail_credit'. They have NEVER
// worked: the constitutional `economy_ledger` (mig 002) is a strict double-entry
// table with `type` CHECK-constrained to a 7-value enum (TOKEN_PURCHASE…REVERSAL),
// `amount > 0`, `net > 0` NOT NULL — so these inserts both name missing columns AND
// would fail the CHECKs (auction/mail debits pass a NEGATIVE amount). Every one is
// wrapped in `try { … } catch { /* ledger optional */ }`, so they silently no-op
// while the paired `user_wallets` credit/debit (the real money movement) succeeds.
//
// These rows are an activity/reward audit trail, not financial double-entry, so the
// correct home is a dedicated lightweight table — NOT the constitutional ledger
// (shoehorning them in would pollute the currency-conservation invariant set). This
// table carries exactly the shape the six inserts expect; they repoint here.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reward_ledger (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      kind       TEXT NOT NULL,
      amount_cc  REAL NOT NULL DEFAULT 0,
      ts         INTEGER NOT NULL DEFAULT (unixepoch()),
      ref_id     TEXT,
      memo       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reward_ledger_user ON reward_ledger(user_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_reward_ledger_kind ON reward_ledger(kind, ts DESC);
  `);
}

export function down(_db) {
  // forward-only
}
