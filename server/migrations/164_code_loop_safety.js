// server/migrations/164_code_loop_safety.js
//
// Phase 9.5 — code-loop + safety + B2B.
//
//   - bounty_stakes: CC stakes on competing autofix patches
//   - sandbox_tenants: B2B agent-rental records (federated peers
//     marked is_sandbox=1)
//   - skill_divergence_alerts: psyops-detector findings on suspect
//     NPC mentor demos

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bounty_stakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      autofix_id INTEGER NOT NULL,
      staker_user_id TEXT NOT NULL,
      patch_choice INTEGER NOT NULL,
      stake_cc INTEGER NOT NULL,
      placed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      payout_cc INTEGER,
      paid_at INTEGER
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bounty_autofix ON bounty_stakes(autofix_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bounty_staker ON bounty_stakes(staker_user_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sandbox_tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_org TEXT NOT NULL,
      tenant_contact TEXT,
      monthly_cc INTEGER NOT NULL,
      isolation_level TEXT NOT NULL DEFAULT 'strict',
      kill_switch_url TEXT,
      provisioned_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      escrow_cc INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sandbox_status ON sandbox_tenants(status)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_divergence_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id TEXT NOT NULL,
      suspect_mentor_id TEXT,
      revision_count_window INTEGER NOT NULL,
      cohort_baseline REAL NOT NULL,
      sigma_above REAL NOT NULL,
      detected_at INTEGER NOT NULL DEFAULT (unixepoch()),
      quarantined INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_skilldiv_npc ON skill_divergence_alerts(npc_id, detected_at DESC)`);
}
