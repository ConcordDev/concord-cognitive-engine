// server/migrations/204_producer_credits.js
//
// Sprint B Item #11 — Mentorship-as-production credits.
//
// A producer can hire another producer (human or emergent) as a
// mixer / arranger / mastering engineer / co-producer / session
// player on their track. Once the work ships, the hiree is credited
// in the production credits table and routed a partial share of the
// cascade.
//
// Append-only per the "migrations are append-only" invariant.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS producer_credits (
      id TEXT PRIMARY KEY,
      production_dtu_id TEXT NOT NULL,
      producer_user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      skill_level_at_credit INTEGER NOT NULL DEFAULT 1,
      contribution_ratio REAL NOT NULL CHECK (contribution_ratio > 0 AND contribution_ratio <= 1),
      cc_payment_at_credit REAL DEFAULT 0,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(production_dtu_id, producer_user_id, role)
    );

    CREATE INDEX IF NOT EXISTS idx_producer_credits_dtu
      ON producer_credits(production_dtu_id);
    CREATE INDEX IF NOT EXISTS idx_producer_credits_user
      ON producer_credits(producer_user_id, created_at DESC);
  `);
}

export function down(db) {
  // Append-only; no destructive down.
  db.exec(`DROP TABLE IF EXISTS producer_credits;`);
}
