// server/migrations/079_concord_link_walker_journeys.js
//
// Extends the Link Walker substrate with journey state and contract records.
// Walkers existed since 076 but had no notion of route, ETA, or interception
// roll — they were a static row with status. With this migration each walker
// in_transit carries its anchor path, the index it has reached, and the
// per-journey intercept roll, so the world can actually simulate delivery.
//
// Adds two columns to concord_link_walkers + a new contracts table.

export function up(db) {
  for (const col of [
    "ALTER TABLE concord_link_walkers ADD COLUMN route_anchors      TEXT", // JSON array of anchor ids
    "ALTER TABLE concord_link_walkers ADD COLUMN current_anchor_idx INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE concord_link_walkers ADD COLUMN eta_tick            INTEGER",
    "ALTER TABLE concord_link_walkers ADD COLUMN intercept_roll      REAL",
    "ALTER TABLE concord_link_walkers ADD COLUMN dispatched_at       INTEGER",
    "ALTER TABLE concord_link_walkers ADD COLUMN message_id          TEXT",
  ]) {
    try { db.exec(col); }
    catch (e) { if (!/duplicate column/i.test(e?.message || "")) throw e; }
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS concord_link_contracts (
        id              TEXT PRIMARY KEY,
        walker_id       TEXT NOT NULL,
        message_id      TEXT,
        payer_id        TEXT NOT NULL,
        fee_sparks      INTEGER NOT NULL DEFAULT 0,
        status          TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'in_progress', 'delivered', 'lost', 'intercepted', 'cancelled')),
        source_world    TEXT,
        dest_world      TEXT,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at    INTEGER
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_link_contract_walker ON concord_link_contracts(walker_id, status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_link_contract_payer  ON concord_link_contracts(payer_id, created_at DESC)`);
  } catch (e) { if (!/already exists/i.test(e?.message || "")) throw e; }
}
