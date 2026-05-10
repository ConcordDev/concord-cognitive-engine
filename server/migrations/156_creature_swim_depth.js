// Migration 156 — Sprint C / Track C1: aquatic creature swim depth.
//
// Adds swim_depth_min / swim_depth_max columns to procgen_creatures (or
// the equivalent creature population table) so the fauna spawner can
// render aquatic creatures only when the player is at the right depth.
//
// Idempotent guard: ALTER TABLE ADD COLUMN fails if column exists, so
// we wrap each ADD in its own try/catch.

export function up(db) {
  // Best-effort: the creature table has had several names across migrations
  // (creature_population, procgen_creatures, fauna_individuals). Try each.
  for (const tbl of ["procgen_creatures", "creature_population", "fauna_individuals"]) {
    try {
      db.exec(`ALTER TABLE ${tbl} ADD COLUMN swim_depth_min REAL DEFAULT NULL;`);
    } catch { /* column exists or table missing */ }
    try {
      db.exec(`ALTER TABLE ${tbl} ADD COLUMN swim_depth_max REAL DEFAULT NULL;`);
    } catch { /* column exists or table missing */ }
    try {
      db.exec(`ALTER TABLE ${tbl} ADD COLUMN topology TEXT DEFAULT NULL;`);
    } catch { /* column exists or table missing */ }
  }
}

export function down(_db) {
  // Forward-only.
}
