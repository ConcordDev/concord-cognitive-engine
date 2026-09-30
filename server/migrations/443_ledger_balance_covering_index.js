// 443_ledger_balance_covering_index.js
//
// Concurrency Refactor — balance-read path.
//
// economy/balances.js#getBalance runs two aggregations per call:
//   credits: SUM(net)    WHERE to_user_id=?   AND status='complete' AND <CREDIT_ROW_PREDICATE>
//   debits:  SUM(amount) WHERE from_user_id=? AND status='complete'
// and getBalance / hasSufficientBalance has ~51 call sites (every spend checks
// it). The existing idx_ledger_to / idx_ledger_from are (user, created_at) —
// they locate the user's rows but SQLite still visits each row's page to read
// status / type / net / amount and filter+sum.
//
// These two covering indexes let both sums be answered index-only (no table
// page visits) for a heavy user. `type` is included so the CREDIT_ROW_PREDICATE
// (NOT (from_user_id IS NOT NULL AND type IN (...))) is evaluable from the
// index too. Additive, safe to re-run.
//
// This is the cheap, in-process alternative to a Rust balance-read sidecar —
// see docs/CONCURRENCY_STATE_AUDIT.md §2 and the CONCURRENCY_WHATS_LEFT.md
// note on why a second Rust process isn't worth it post-auth-cache.

export function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ledger_credit_sum
      ON economy_ledger(to_user_id, status, type, net);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ledger_debit_sum
      ON economy_ledger(from_user_id, status, amount);
  `);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_ledger_credit_sum;`);
  db.exec(`DROP INDEX IF EXISTS idx_ledger_debit_sum;`);
}
