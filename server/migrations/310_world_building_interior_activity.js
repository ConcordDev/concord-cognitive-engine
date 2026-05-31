// server/migrations/310_world_building_interior_activity.js
//
// WAVE WD — World Density (every door opens). Tier-3 (simulate-only-active)
// needs a persisted "when was this interior last active" signal so the
// dormancy/LOD-of-simulation gate survives a restart (the hot path is an
// in-memory Map in lib/world-density.js, but the Map is cold after a reboot).
// `interior_last_activity_at` is a best-effort unix-seconds stamp written on
// interior entry; NULL = never entered (a candidate for dormancy). Additive,
// forward-only, behind CONCORD_WORLD_DENSITY at the read sites.

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}
function addColumn(db, table, col, ddl) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) return;
  if (!columnExists(db, table, col)) { try { db.exec(ddl); } catch { /* noop */ } }
}

export function up(db) {
  addColumn(db, "world_buildings", "interior_last_activity_at", "ALTER TABLE world_buildings ADD COLUMN interior_last_activity_at INTEGER");
}

export function down(_db) {
  // forward-only (SQLite ADD COLUMN)
}
