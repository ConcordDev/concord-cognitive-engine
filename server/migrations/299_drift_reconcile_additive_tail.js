// server/migrations/299_drift_reconcile_additive_tail.js
//
// Schema/query-drift reconciliation — the genuinely-additive tail (PRAGMA-
// confirmed; same playbook as 294-298). Each is a NEW attribute a live path
// reads/writes that the table never had — additive, not a rename:
//
// - users.{status,merged_into,merged_at} — the account-merge audit trail
//   (account-lifecycle marks the source account 'merged' + points at the
//   survivor). status is the lifecycle string (distinct from is_active).
// - users.primary_lens — the auth flow reads/writes the user's primary lens.
// - world_npcs.migrated_at — npc-consequences stamps when an NPC is relocated
//   to another world.
// - world_npcs.rotation — the combat route reads an NPC's facing rotation.
// - damage_events.{x,z} — the damage-event feed reads the hit position.
// - creative_artifacts.tier_prices_json — per-tier price map.
// - evo_assets.cdn_url — optional CDN mirror of the asset.
// - procedural_npcs.backstory — world-population stamps a generated backstory.
// - download_log.action — the rights-enforcement tracker tags the action kind
//   ('download'); the same INSERT's dtu_id→artifact_id is a code-side rename.

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
  addColumn(db, "users", "status", "ALTER TABLE users ADD COLUMN status TEXT");
  addColumn(db, "users", "merged_into", "ALTER TABLE users ADD COLUMN merged_into TEXT");
  addColumn(db, "users", "merged_at", "ALTER TABLE users ADD COLUMN merged_at TEXT");
  addColumn(db, "users", "primary_lens", "ALTER TABLE users ADD COLUMN primary_lens TEXT");

  addColumn(db, "world_npcs", "migrated_at", "ALTER TABLE world_npcs ADD COLUMN migrated_at INTEGER");
  addColumn(db, "world_npcs", "rotation", "ALTER TABLE world_npcs ADD COLUMN rotation REAL NOT NULL DEFAULT 0");

  addColumn(db, "damage_events", "x", "ALTER TABLE damage_events ADD COLUMN x REAL");
  addColumn(db, "damage_events", "z", "ALTER TABLE damage_events ADD COLUMN z REAL");

  addColumn(db, "creative_artifacts", "tier_prices_json", "ALTER TABLE creative_artifacts ADD COLUMN tier_prices_json TEXT");
  addColumn(db, "evo_assets", "cdn_url", "ALTER TABLE evo_assets ADD COLUMN cdn_url TEXT");
  addColumn(db, "procedural_npcs", "backstory", "ALTER TABLE procedural_npcs ADD COLUMN backstory TEXT");

  addColumn(db, "download_log", "action", "ALTER TABLE download_log ADD COLUMN action TEXT");
}

export function down(_db) {
  // forward-only
}
