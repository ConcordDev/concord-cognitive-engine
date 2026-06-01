// server/migrations/321_faction_funding.js
//
// Managed-parity substrate (Sere / the Tessera). Records a third party that funds
// BOTH sides of a war so it never resolves — the satire's central mechanic. The
// tessera-parity heartbeat reads active rows and clamps the belligerents'
// faction_strategy_state.momentum so it can never reach the truce threshold
// (-0.6); removing the funding (the main-arc payoff) lets the war finally end.
//
// Scoped by world_id so it only ever acts on Sere. Discoverable via the Ledger
// lens (economy-flows#anomalousFlows reads this table).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS faction_funding (
      id          TEXT PRIMARY KEY,
      world_id    TEXT NOT NULL,
      funder_id   TEXT NOT NULL,          -- the stabilizing third party (e.g. the_tessera)
      war_faction_a TEXT NOT NULL,        -- the two belligerents kept in parity
      war_faction_b TEXT NOT NULL,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at    INTEGER,
      UNIQUE (world_id, funder_id, war_faction_a, war_faction_b)
    );
    CREATE INDEX IF NOT EXISTS idx_faction_funding_world ON faction_funding(world_id, active);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS faction_funding;`);
}
