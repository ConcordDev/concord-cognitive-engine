// server/migrations/294_player_inventory_reconcile.js
//
// Schema/query-drift reconciliation. The drift gate found ~90 sites across ~20
// files that read/write player_inventory columns the table never had: `id`,
// `item_name`, `item_type`, `quality`, `schema_id`, `gear_level`. Root cause:
// mig 035 created player_inventory (PK user_id,item_id; metadata JSON), and a
// later `CREATE IF NOT EXISTS` with the richer shape silently no-op'd — so the
// code written against that shape threw "no such column" (or silently no-op'd in
// try/catch: loot drops, fishing catches, crafting outputs, NPC-shop buys, quest
// rewards, trades never persisted). These are genuinely NEW per-item attributes
// (they don't duplicate item_id/metadata), so the lowest-risk fix is to ADD them
// — reconciling the schema to what the code expects, zero code churn.
//
// NB: this clears the column-existence drift + restores the queries; the deeper
// id-keyed-vs-(user_id,item_id)-keyed SEMANTICS (distinct-instance vs stacked) is
// a separate behavioral concern tracked for follow-up.

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='player_inventory'").get()) return;
  for (const [col, ddl] of [
    ["id", "ALTER TABLE player_inventory ADD COLUMN id TEXT"],
    ["item_name", "ALTER TABLE player_inventory ADD COLUMN item_name TEXT"],
    ["item_type", "ALTER TABLE player_inventory ADD COLUMN item_type TEXT"],
    ["quality", "ALTER TABLE player_inventory ADD COLUMN quality REAL"],
    ["schema_id", "ALTER TABLE player_inventory ADD COLUMN schema_id TEXT"],
    ["gear_level", "ALTER TABLE player_inventory ADD COLUMN gear_level INTEGER"],
  ]) {
    if (!columnExists(db, "player_inventory", col)) {
      try { db.exec(ddl); } catch { /* noop */ }
    }
  }
  // Index on id so the id-keyed read/update paths don't full-scan.
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_player_inventory_id ON player_inventory(id)"); } catch { /* noop */ }
}

export function down(_db) {
  // forward-only
}
