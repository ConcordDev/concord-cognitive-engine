// server/migrations/295_dtus_pipeline_reconcile.js
//
// Schema/query-drift reconciliation for the legacy DTU-pipeline column shape.
//
// `server/economy/dtu-pipeline.js` is a large, internally self-consistent module
// (createDTU + compressToDMega/Hyper + forkDTU + listDTU/searchDTUs/getDTUPreview/
// recalculateCRETI) written against a `content` / `content_type` / `metadata_json`
// / `status` column shape. The migrated `dtus` table carries the newer canonical
// `type` / `data` / `visibility` shape instead, so EVERY createDTU call throws
// ("dtu_creation_failed", runtime-confirmed) — the personal-locker + match-chronicle
// DTU-creation paths that import createDTU have been silently broken.
//
// Root cause is the same CREATE-IF-NOT-EXISTS collision as player_inventory (mig 294):
// the richer pipeline shape lost to an earlier canonical CREATE. The lowest-risk,
// reversible fix is to ADD the four legacy columns so the self-consistent module
// (writer AND its readers) works again with zero code churn — rather than rewrite a
// load-bearing economy module + every reader to fold into `data` JSON.
//
// These are additive and disjoint from the canonical `type`/`data` columns: a
// pipeline-created DTU populates content/metadata_json, a canonical-path DTU
// populates type/data. The two reader populations (marketplace listings vs lens
// DTUs) are effectively disjoint, so no split-brain. Also satisfies the
// consent.js + backfill-base6 metadata_json references.

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dtus'").get()) return;
  for (const [col, ddl] of [
    ["content", "ALTER TABLE dtus ADD COLUMN content TEXT"],
    ["content_type", "ALTER TABLE dtus ADD COLUMN content_type TEXT"],
    ["metadata_json", "ALTER TABLE dtus ADD COLUMN metadata_json TEXT"],
    ["status", "ALTER TABLE dtus ADD COLUMN status TEXT"],
  ]) {
    if (!columnExists(db, "dtus", col)) {
      try { db.exec(ddl); } catch { /* noop */ }
    }
  }
  // searchDTUs filters WHERE status = 'published'; index it so the scan stays cheap.
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_dtus_status ON dtus(status)"); } catch { /* noop */ }
}

export function down(_db) {
  // forward-only
}
