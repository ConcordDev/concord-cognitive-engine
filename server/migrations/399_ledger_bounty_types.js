// server/migrations/399_ledger_bounty_types.js
//
// Broaden the economy_ledger type CHECK to admit BOUNTY_ESCROW / BOUNTY_CLAIM,
// and fixes a real fee-drain bug in the bounty flow (economy/lens-economy-
// wiring.js#postBounty / #claimBounty), found 2026-07-30 while verifying an
// unrelated authorization fix.
//
// THE BUG: postBounty() escrows the poster's stake via a `type: "TRANSFER"`
// move into the internal `__ESCROW__` holding account. TRANSFER carries a real
// fee (FEES.TRANSFER = 0.0146 in economy/fees.js), so `__ESCROW__` only ever
// receives `bounty.amount * (1 - 0.0146)`. claimBounty() then tries to release
// the FULL original `bounty.amount` out of escrow — so every real bounty claim
// fails with `insufficient_balance`, regardless of who's claiming. Reproduced
// directly: `postBounty(db, {posterId, title, amount: 300, ...})` followed by
// `claimBounty(...)` for the resulting bounty returns
// `{ ok:false, error:"insufficient_balance" }` on a fresh in-memory db with no
// other activity.
//
// THE FIX: escrow/claim are internal bookkeeping moves, not a real economic
// transaction between two independent parties choosing to trade — exactly the
// same shape as the STAKE_ESCROW / STAKE_RETURN types migration 372 added for
// the staking lens, which are (deliberately) absent from fees.js's FEES map
// and therefore already fee-exempt via `calculateFee`'s `FEES[type] ?? 0`
// fallback. This migration adds two new ledger types, BOUNTY_ESCROW and
// BOUNTY_CLAIM, following the identical precedent — also absent from FEES, so
// they inherit the same fee-exempt behavior with zero change to fees.js. The
// paired code change (lens-economy-wiring.js) swaps `type: "TRANSFER"` for
// these two new types on the escrow-in and claim-out transfers; the existing
// `metadata.subtype: "BOUNTY_ESCROW"/"BOUNTY_CLAIM"` fields are left as-is
// (now redundant with `type` but harmless, and other readers may depend on
// the metadata shape).
//
// This does NOT change how bounties work for the poster or claimer in any
// other way: the poster still escrows the full posted amount (now fee-free,
// which is what "escrow the full amount, disburse the full amount" already
// implied), and the claimer now actually receives the full amount instead of
// the claim always failing. No balance math changes; conservation is
// unaffected (the platform previously collected the TRANSFER fee twice — once
// silently absorbing it into a permanently-locked escrow account and once
// on the way in — this fix removes that unintended lock, not any legitimate
// platform revenue, since the fee was never actually collectible: the
// escrowed funds could never be claimed at all before this fix).
//
// SQLite can't ALTER a CHECK, so the table is rebuilt (create-new → copy →
// drop → rename → re-index), identical in shape to migrations 372/395 apart
// from the two added values. Runs inside the migration runner's own
// db.transaction() (migrate.js) — any failure rolls the whole rebuild back.
// Idempotent + guarded: no-op if the table is absent or already widened.

export function up(db) {
  const cur = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='economy_ledger'",
  ).get();
  // Table not created yet (minimal build) OR already widened → nothing to do.
  if (!cur || !cur.sql || /BOUNTY_ESCROW/.test(cur.sql)) return;

  db.exec(`
    CREATE TABLE economy_ledger_new (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL CHECK(type IN (
        'TOKEN_PURCHASE','TRANSFER','MARKETPLACE_PURCHASE',
        'ROYALTY_PAYOUT','WITHDRAWAL','FEE','REVERSAL',
        'STAKE_ESCROW','STAKE_RETURN','STAKE_YIELD','STAKE_PENALTY',
        'EMERGENT_TRANSFER','ADJUSTMENT','MAKE_GOOD',
        'BOUNTY_ESCROW','BOUNTY_CLAIM'
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

  // Recreate the exact index set (002 + 004), matching migrations 372/395.
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
