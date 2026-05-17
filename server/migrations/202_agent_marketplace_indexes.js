// server/migrations/202_agent_marketplace_indexes.js
//
// Phase 13 (Stage C) — query indexes for the agent marketplace.
//
// No kind constraint migration is needed — `dtus.kind` is unconstrained
// TEXT (migration 001), so agent_spec DTUs persist without schema change.
// This migration adds the two indexes the marketplace queries lean on:
//
//   - "list newest agents" / "list agents by creator" (kind+creator+ts)
//   - "list all agent_spec DTUs newest-first" (partial index)
//
// royalty_payouts already has idx_royalty_recipient (recipient_id,
// created_at) from migration 008 — the earnings query falls back to that.

export function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_dtus_agent_spec_by_creator
      ON dtus(creator_id, created_at DESC) WHERE kind = 'agent_spec';
    CREATE INDEX IF NOT EXISTS idx_dtus_agent_spec_newest
      ON dtus(created_at DESC) WHERE kind = 'agent_spec';
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_dtus_agent_spec_newest;
    DROP INDEX IF EXISTS idx_dtus_agent_spec_by_creator;
  `);
}
