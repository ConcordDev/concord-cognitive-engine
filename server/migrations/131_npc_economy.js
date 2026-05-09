// Migration 131 — Phase 4b: Living Economy.
//
// NPCs in 'craft' / 'gather' / 'trade' blocks (Phase 4a) actually
// produce, consume, and move resources. Per-world flows aggregate
// into a regional scarcity index that modulates marketplace prices.
//
// Tables:
//   npc_inventory     — per (npc_id, resource_kind) quantity
//   economy_flows     — append-only ledger of every gather/craft/trade
//                       action. Read by computeRegionalScarcity over a
//                       rolling window.
//   regional_scarcity — cached scarcity index per (world_id, resource_kind)
//                       so price reads are O(1).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_inventory (
      npc_id        TEXT    NOT NULL,
      resource_kind TEXT    NOT NULL,
      quantity      INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (npc_id, resource_kind)
    );
    CREATE INDEX IF NOT EXISTS idx_npc_inv_resource ON npc_inventory(resource_kind, quantity);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS economy_flows (
      id            TEXT    PRIMARY KEY,
      world_id      TEXT    NOT NULL,
      npc_id        TEXT    NOT NULL,
      flow_kind     TEXT    NOT NULL CHECK (flow_kind IN (
                              'gather', 'craft_input', 'craft_output',
                              'trade_in', 'trade_out', 'consume')),
      resource_kind TEXT    NOT NULL,
      quantity      INTEGER NOT NULL,
      occurred_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_econ_flow_world_resource
      ON economy_flows(world_id, resource_kind, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_econ_flow_npc
      ON economy_flows(npc_id, occurred_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS regional_scarcity (
      world_id      TEXT    NOT NULL,
      resource_kind TEXT    NOT NULL,
      scarcity      REAL    NOT NULL DEFAULT 0
                            CHECK (scarcity >= -1 AND scarcity <= 2),
      computed_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (world_id, resource_kind)
    );
  `);
}

export function down(_db) { /* forward-only */ }
