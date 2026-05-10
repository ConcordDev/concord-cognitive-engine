// server/migrations/163_economy_primitives.js
//
// Phase 9.4 — sponsorship + staking + insurance.
//
//   - npc_sponsorships  — sponsor pays mentor in CC for periodic NPC dispatches
//   - cc_stakes         — time-locked CC earning treasury yield
//   - insurance_contracts — sparks-only death-lottery insurance (insulated
//                            from CC per the CC vs Sparks invariant)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_sponsorships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id TEXT NOT NULL,
      sponsor_user_id TEXT NOT NULL,
      monthly_cc INTEGER NOT NULL,
      dispatch_freq_hours INTEGER NOT NULL DEFAULT 168,
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_dispatch_at INTEGER,
      ended_at INTEGER,
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sponsor_npc ON npc_sponsorships(npc_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sponsor_sponsor ON npc_sponsorships(sponsor_user_id, status)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cc_stakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      principal_cc INTEGER NOT NULL,
      stake_months INTEGER NOT NULL,
      locked_at INTEGER NOT NULL DEFAULT (unixepoch()),
      unlocks_at INTEGER NOT NULL,
      yield_rate_bps INTEGER NOT NULL DEFAULT 0,
      accrued_yield_cc INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stakes_user ON cc_stakes(user_id, status)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS insurance_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      insured_user_id TEXT NOT NULL,
      beneficiary_user_id TEXT NOT NULL,
      premium_sparks INTEGER NOT NULL,
      payout_sparks INTEGER NOT NULL,
      written_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      claimed_at INTEGER,
      revoked_at INTEGER
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_insurance_insured ON insurance_contracts(insured_user_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_insurance_beneficiary ON insurance_contracts(beneficiary_user_id, status)`);
}
