// server/migrations/395_ledger_emergent_and_correction_types.js
//
// Broaden the economy_ledger type CHECK to admit three more types that live
// code already writes and that therefore fail on every real migrated DB:
//
//   EMERGENT_TRANSFER — server/economy/emergent-accounts.js#transferToReserve,
//                       reachable from the live route economy/routes.js:1254.
//   ADJUSTMENT        — economy/reconciliation.js#executeAdjustmentCorrection
//   MAKE_GOOD         — economy/reconciliation.js#executeMakeGoodCorrection
//
// This is the SAME bug class migration 372 fixed for the four STAKE_* types,
// found again by auditing which `type:` values the economy code actually
// records against the allowlist. Verified at runtime, not inferred: on a
// fully migrated in-memory DB, `transferToReserve` returns
// { ok:false, error:"transfer_failed" }, and a direct
// `INSERT ... type='EMERGENT_TRANSFER'` reports
// "CHECK constraint failed: type IN (...)". The insert happens inside the
// function's own db.transaction(), so the balance update rolls back with it —
// no money was lost or double-counted, the operation simply never worked.
//
// Severity note: the two reconciliation types are the correction half of
// treasury reconciliation. Drift could be detected but the corrective ledger
// entry could never be written.
//
// Migration 008 is why this went unnoticed: its comment claims "EMERGENT_TRANSFER
// will work because we recreate the table with expanded constraints", then in
// the next breath says it is "handled at the application layer" and does
// nothing to economy_ledger at all. The comment described an intent that was
// never implemented.
//
// Deliberately NOT widened: BOUNTY_ESCROW / BOUNTY_CLAIM / DTU_PURCHASE / TIP
// appear in economy/lens-economy-wiring.js as `metadata.subtype` alongside an
// already-allowed `type`, which is correct usage and needs no change. Only
// values genuinely passed as `type` are added here.
//
// SQLite can't ALTER a CHECK, so the table is rebuilt (create-new → copy →
// drop → rename → re-index), byte-identical to migration 372's approach and
// column-for-column identical to its schema apart from the three added values.
// This runs INSIDE the migration runner's own db.transaction() (migrate.js),
// so any failure rolls the whole rebuild back. It is a pure widening: no
// column, index, or other CHECK changes, and no balance is computed here —
// conservation math is untouched. Idempotent + guarded: a no-op if the table
// is absent or already carries the widened CHECK.

export function up(db) {
  const cur = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='economy_ledger'",
  ).get();
  // Table not created yet (minimal build) OR already widened → nothing to do.
  if (!cur || !cur.sql || /EMERGENT_TRANSFER/.test(cur.sql)) return;

  db.exec(`
    CREATE TABLE economy_ledger_new (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL CHECK(type IN (
        'TOKEN_PURCHASE','TRANSFER','MARKETPLACE_PURCHASE',
        'ROYALTY_PAYOUT','WITHDRAWAL','FEE','REVERSAL',
        'STAKE_ESCROW','STAKE_RETURN','STAKE_YIELD','STAKE_PENALTY',
        'EMERGENT_TRANSFER','ADJUSTMENT','MAKE_GOOD'
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

  // Copy every existing row verbatim (explicit column list — order-safe).
  db.exec(`
    INSERT INTO economy_ledger_new
      (id, type, from_user_id, to_user_id, amount, fee, net, status, metadata_json, request_id, ip, created_at, ref_id)
    SELECT
      id, type, from_user_id, to_user_id, amount, fee, net, status, metadata_json, request_id, ip, created_at, ref_id
    FROM economy_ledger;
  `);

  db.exec(`DROP TABLE economy_ledger;`);
  db.exec(`ALTER TABLE economy_ledger_new RENAME TO economy_ledger;`);

  // Recreate the exact index set (002 + 004), matching migration 372.
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
