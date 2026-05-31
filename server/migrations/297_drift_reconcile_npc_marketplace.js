// server/migrations/297_drift_reconcile_npc_marketplace.js
//
// Schema/query-drift reconciliation for two genuinely-additive column clusters
// (runtime-confirmed against PRAGMA; same playbook as mig 294/295/296):
//
// 1. world_npcs.narrative_context — authored/emergent per-NPC context that five
//    sites read or write (world-population-cycle select+update, ai-residents
//    insert, npc-persona import insert) but the table never had. It's a genuinely
//    new per-NPC attribute (distinct from the `state` JSON blob and `needs_json`),
//    so ADD it rather than fold per-site.
//
// 2. marketplace_listings.status + artifact_id — the listings table is a
//    collision-merged v1(owner_user_id/price_cents/visibility) + v2(dtu_id/
//    seller_id/price/license_type/listed_at) shape. The lifecycle `status`
//    ('active'/'sold') and the npc-recipe `artifact_id` ref were the two v2
//    columns that never landed, so dtu-pipeline listDTU + npc-marketplace
//    list/lookup all reference missing columns. Both are genuinely-distinct
//    attributes (status ≠ visibility; artifact_id ≠ dtu_id), so ADD them.

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

function addColumn(db, table, col, ddl) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) return;
  if (!columnExists(db, table, col)) {
    try { db.exec(ddl); } catch { /* noop */ }
  }
}

export function up(db) {
  addColumn(db, "world_npcs", "narrative_context",
    "ALTER TABLE world_npcs ADD COLUMN narrative_context TEXT");

  addColumn(db, "marketplace_listings", "status",
    "ALTER TABLE marketplace_listings ADD COLUMN status TEXT");
  addColumn(db, "marketplace_listings", "artifact_id",
    "ALTER TABLE marketplace_listings ADD COLUMN artifact_id TEXT");

  // npc-marketplace looks listings up by (artifact_id, status); index the pair.
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_marketplace_listings_artifact ON marketplace_listings(artifact_id, status)");
  } catch { /* noop */ }
}

export function down(_db) {
  // forward-only
}
