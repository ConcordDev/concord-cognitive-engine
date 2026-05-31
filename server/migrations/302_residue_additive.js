// server/migrations/302_residue_additive.js
//
// Genuinely-additive columns behind already-wired consumers (build-everything tail):
//
// - world_buildings.{kingdom_id,build_cost} — lib/world-buildings-repair.js gates
//   repair authority on kingdom ownership and prices the repair off build_cost;
//   the table had neither, so repair threw. (owner_user_id is a code-side rename
//   to the existing owner_id.)
// - dtus.production_brain_interaction_id — provenance link the royalty cascade
//   reads behind a colCheck guard ("preferred when migration adds it"). Adding it
//   activates the guarded path.

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}
function addColumn(db, table, col, ddl) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) return;
  if (!columnExists(db, table, col)) { try { db.exec(ddl); } catch { /* noop */ } }
}

export function up(db) {
  addColumn(db, "world_buildings", "kingdom_id", "ALTER TABLE world_buildings ADD COLUMN kingdom_id TEXT");
  addColumn(db, "world_buildings", "build_cost", "ALTER TABLE world_buildings ADD COLUMN build_cost INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "dtus", "production_brain_interaction_id", "ALTER TABLE dtus ADD COLUMN production_brain_interaction_id TEXT");
}

export function down(_db) {
  // forward-only
}
