// server/migrations/372_ledger_staking_types.js
//
// Broaden the economy_ledger type CHECK to admit the four staking movement
// types. The staking lens (server/domains/staking.js, rewritten 2026-07 to move
// REAL CC) records principal escrow / return and treasury-funded yield / penalty
// as double-entry economy_ledger rows so the user's wallet balance actually
// changes. Migration 002 constrained `type` to a narrow 7-value allowlist that
// predates staking, so those rows fail `CHECK constraint failed: type IN (...)`
// on a real migrated DB — open_stake would throw and the whole staking money
// path is dead. This adds STAKE_ESCROW / STAKE_RETURN / STAKE_YIELD /
// STAKE_PENALTY.
//
// SQLite can't ALTER a CHECK, so the table is rebuilt (create-new → copy → drop
// → rename → re-index). This runs INSIDE the migration runner's own
// db.transaction() (migrate.js:88), so it is atomic: any failure rolls the whole
// rebuild back and leaves economy_ledger untouched. The rebuild is a pure
// widening — it adds four accepted values and changes NOTHING else (same
// columns, same amount>0 / net>0 / fee>=0 / status / from-or-to CHECKs, same six
// indexes incl. the unique partial ref_id-debit index). Conservation math is
// unaffected: no balance is computed here; this only lets already-conservation-
// safe transfer rows be recorded. Idempotent + guarded: no-op if the table is
// absent or already carries the widened CHECK.

export function up(db) {
  const cur = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='economy_ledger'",
  ).get();
  // Table not created yet (minimal build) OR already widened → nothing to do.
  if (!cur || !cur.sql || /STAKE_ESCROW/.test(cur.sql)) return;

  // 1. New table with the widened type CHECK; every other column + CHECK is
  //    byte-identical to the migration-002 schema + the migration-004 ref_id col.
  db.exec(`
    CREATE TABLE economy_ledger_new (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL CHECK(type IN (
        'TOKEN_PURCHASE','TRANSFER','MARKETPLACE_PURCHASE',
        'ROYALTY_PAYOUT','WITHDRAWAL','FEE','REVERSAL',
        'STAKE_ESCROW','STAKE_RETURN','STAKE_YIELD','STAKE_PENALTY'
      )),
      from_user_id  TEXT,
      to_user_id    TEXT,
      amount        REAL NOT NULL CHECK(amount > 0),
      fee           REAL NOT NULL DEFAULT 0 CHECK(fee >= 0),
      net           REAL NOT NULL CHECK(net > 0),
      status        TEXT NOT NULL DEFAULT 'complete' CHECK(status IN ('pending','complete','reversed')),
      metadata_json TEXT DEFAULT '{}',
      request_id    TEXT,
      ip            TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      ref_id        TEXT,
      CHECK(from_user_id IS NOT NULL OR to_user_id IS NOT NULL)
    );
  `);

  // 2. Copy every existing row verbatim (explicit column list — order-safe).
  db.exec(`
    INSERT INTO economy_ledger_new
      (id, type, from_user_id, to_user_id, amount, fee, net, status, metadata_json, request_id, ip, created_at, ref_id)
    SELECT
      id, type, from_user_id, to_user_id, amount, fee, net, status, metadata_json, request_id, ip, created_at, ref_id
    FROM economy_ledger;
  `);

  // 3. Swap.
  db.exec(`DROP TABLE economy_ledger;`);
  db.exec(`ALTER TABLE economy_ledger_new RENAME TO economy_ledger;`);

  // 4. Recreate the exact index set (002 + 004).
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ledger_from   ON economy_ledger(from_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ledger_to     ON economy_ledger(to_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ledger_type   ON economy_ledger(type);
    CREATE INDEX IF NOT EXISTS idx_ledger_status ON economy_ledger(status);
    CREATE INDEX IF NOT EXISTS idx_ledger_time   ON economy_ledger(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_ref_id_debit
      ON economy_ledger(ref_id)
      WHERE ref_id IS NOT NULL AND json_extract(metadata_json, '$.role') = 'debit';
  `);
}
