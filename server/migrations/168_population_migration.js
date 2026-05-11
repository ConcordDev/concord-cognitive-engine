// server/migrations/168_population_migration.js
//
// Population migration substrate — sprint 3 of multi-world parity.
//
// NPC conservation invariant (the locked Sprint 3 acceptance):
//   For any time t and any world W:
//     residents(W, t) + outbound_in_transit_from(W, t) =
//       initial_population(W) - net_arrivals_elsewhere_from(W, t)
//   In plain terms: no NPCs are created or destroyed by migration;
//   they only change their (world_id, in_transit) state.
//
// Schema:
//   population_flow_events — append-only ledger of every migration.
//     status ∈ in_transit | arrived | lost
//     CHECK (from_world_id <> to_world_id) — boundary discipline
//     UNIQUE (npc_id) WHERE status = 'in_transit' enforced by partial
//     index — an NPC can never be in two places at once.
//
// Reuses Sprint 1 transport_routes for distance_units → transit time.
// Every cross-world op gates on Sprint 1 cross_world_kill_switch.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS population_flow_events (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id                TEXT    NOT NULL,
      from_world_id         TEXT    NOT NULL,
      to_world_id           TEXT    NOT NULL,
      departed_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      expected_arrival_at   INTEGER NOT NULL,
      arrived_at            INTEGER,
      status                TEXT    NOT NULL DEFAULT 'in_transit'
                                    CHECK (status IN ('in_transit','arrived','lost')),
      reason                TEXT,
      meta_json             TEXT,
      CHECK (from_world_id <> to_world_id)
    )
  `);

  // Partial unique index — an NPC can have at most one in-transit event.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pop_flow_in_transit_unique
    ON population_flow_events(npc_id) WHERE status = 'in_transit'
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pop_flow_status ON population_flow_events(status, expected_arrival_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pop_flow_from ON population_flow_events(from_world_id, departed_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pop_flow_to ON population_flow_events(to_world_id, arrived_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pop_flow_npc ON population_flow_events(npc_id)`);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS population_flow_events`);
}
