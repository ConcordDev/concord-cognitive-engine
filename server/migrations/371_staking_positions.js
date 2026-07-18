// server/migrations/371_staking_positions.js
//
// Persist staking positions + liquid-staking receipts.
//
// Before this, the staking lens (server/domains/staking.js) kept ALL position
// state in globalThis._concordSTATE Maps AND moved NO real CC — open_stake
// "locked" a principal that was never debited from the wallet, and redeem_stake
// returned "principal + yield" as currency:"CC" that was never credited. Two
// defects in one: fabricated money movement, and state that evaporated on every
// restart.
//
// The fix wires staking to the real economy_ledger (principal escrowed to a
// `staking_escrow` account on open; principal returned + treasury-funded yield
// paid on redeem — never minted from nothing). Real CC in escrow MUST be backed
// by a durable position record, or a restart would strand a user's principal in
// the escrow account with no position to redeem it. Hence these tables.
//
// Schema:
//   - staking_positions: one row per opened position, keyed by id.
//   - staking_receipts:  liquid-staking receipt tokens (optional per position).
// Money movement itself lives in economy_ledger (STAKE_ESCROW / STAKE_RETURN /
// STAKE_YIELD / STAKE_PENALTY rows) — these tables track lifecycle only.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staking_positions (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL,
      pool_id        TEXT NOT NULL,
      pool_name      TEXT NOT NULL,
      principal_cc   REAL NOT NULL,
      stake_months   INTEGER NOT NULL,
      locked_at      INTEGER NOT NULL,
      unlocks_at     INTEGER NOT NULL,
      yield_rate_bps INTEGER NOT NULL,
      auto_compound  INTEGER NOT NULL DEFAULT 0,
      compound_count INTEGER NOT NULL DEFAULT 0,
      final_yield_cc REAL NOT NULL DEFAULT 0,
      penalty_cc     REAL NOT NULL DEFAULT 0,
      status         TEXT NOT NULL DEFAULT 'active',
        -- active | redeemed | early_exited
      receipt_token_id TEXT,
      redeemed_at    INTEGER,
      exited_at      INTEGER,
      created_at     INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_staking_positions_user ON staking_positions(user_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_staking_positions_unlock ON staking_positions(status, unlocks_at)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS staking_receipts (
      id            TEXT PRIMARY KEY,
      stake_id      TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      symbol        TEXT NOT NULL,
      face_value_cc REAL NOT NULL,
      minted_at     INTEGER NOT NULL,
      unlocks_at    INTEGER NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active',
        -- active | redeemed | transferred
      transferable  INTEGER NOT NULL DEFAULT 1,
      transferred_from TEXT,
      transferred_at INTEGER,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_staking_receipts_user ON staking_receipts(user_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_staking_receipts_stake ON staking_receipts(stake_id)`);
}
