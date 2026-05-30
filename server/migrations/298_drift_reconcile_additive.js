// server/migrations/298_drift_reconcile_additive.js
//
// Schema/query-drift reconciliation — genuinely-additive / collision-merged
// column clusters (runtime-confirmed against PRAGMA; same playbook as 294-297).
// Each cluster is a self-consistent reader+writer that references columns the
// migrated table never had; the columns are genuinely-new attributes (not
// renames of existing ones), so ADD them rather than rewrite the feature.
//
// - api_keys.{status,tier,total_calls} — the api-billing module (issue/verify/
//   meter keys) tracks a lifecycle status, a pricing tier, and a call counter.
//   The collision-merged api_keys (auth shape won the CREATE) lacks all three;
//   the billing INSERT already supplies every real column + status, so additive.
// - player_companions.state_json — the mount-bonding macros store loyalty +
//   relationship_log as an opaque JSON blob; the table has scalar columns but no
//   blob, so the read/update no-op'd.
// - player_oxygen.{last_depth_m,last_x,last_z} — the submarine dive-state cycle
//   needs the diver's last depth + position; the oxygen table tracked only
//   oxygen_pct/max_depth_explored. DEFAULT 0 so the `WHERE last_depth_m > 4`
//   candidate scan returns sane rows.
// - world_crises.resolved_at — the crisis-resolution UPDATE stamps a resolution
//   timestamp distinct from started_at/ends_at; the table had no such column so
//   resolution threw (NULL default makes the `resolved_at IS NULL` guard work).

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
  addColumn(db, "api_keys", "status", "ALTER TABLE api_keys ADD COLUMN status TEXT DEFAULT 'active'");
  addColumn(db, "api_keys", "tier", "ALTER TABLE api_keys ADD COLUMN tier TEXT DEFAULT 'free'");
  addColumn(db, "api_keys", "total_calls", "ALTER TABLE api_keys ADD COLUMN total_calls INTEGER NOT NULL DEFAULT 0");

  addColumn(db, "player_companions", "state_json", "ALTER TABLE player_companions ADD COLUMN state_json TEXT");

  addColumn(db, "player_oxygen", "last_depth_m", "ALTER TABLE player_oxygen ADD COLUMN last_depth_m REAL NOT NULL DEFAULT 0");
  addColumn(db, "player_oxygen", "last_x", "ALTER TABLE player_oxygen ADD COLUMN last_x REAL NOT NULL DEFAULT 0");
  addColumn(db, "player_oxygen", "last_z", "ALTER TABLE player_oxygen ADD COLUMN last_z REAL NOT NULL DEFAULT 0");

  addColumn(db, "world_crises", "resolved_at", "ALTER TABLE world_crises ADD COLUMN resolved_at INTEGER");
}

export function down(_db) {
  // forward-only
}
