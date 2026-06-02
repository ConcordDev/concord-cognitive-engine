// migrations/324_ledger_balance_covering_index.js
//
// Covering indexes for getBalance (economy/balances.js).
//
// Balance is event-sourced — getBalance sums a user's *complete* ledger rows:
//   credits: SUM(net)    WHERE to_user_id   = ? AND status = 'complete'
//   debits:  SUM(amount) WHERE from_user_id = ? AND status = 'complete'
//
// The existing idx_ledger_to / idx_ledger_from are (user_id, created_at): they
// locate a user's rows but SQLite must then fetch each row from the table to read
// `status` and `net`/`amount`. These two composite indexes carry status + the
// summed column, so each query is an INDEX-ONLY scan — O(matching rows), no heap
// access — and stays fast no matter how large a user's history grows.
//
// Why an index and NOT a cached/stored balance:
//   Ledger rows are not immutable. Stripe settles pending→complete
//   (economy/stripe.js:703), reversals flip →reversed
//   (economy/transfer.js, economy/reconciliation.js), and GDPR rewrites
//   from/to_user_id (lib/account-lifecycle.js). A stateful balance cache would
//   have to be invalidated at every one of those scattered mutation sites; the
//   first time a new mutation path is added and the invalidation is forgotten,
//   balances drift silently — the exact correctness bug the event-sourced design
//   currently makes *impossible* (balance is a pure function of the ledger). The
//   safe optimization is to keep that pure function and make it index-cheap.
//   Do NOT add a stored balance column or a stateful balance cache.

export function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ledger_balance_credits
      ON economy_ledger(to_user_id, status, net);

    CREATE INDEX IF NOT EXISTS idx_ledger_balance_debits
      ON economy_ledger(from_user_id, status, amount);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_ledger_balance_credits;
    DROP INDEX IF EXISTS idx_ledger_balance_debits;
  `);
}
