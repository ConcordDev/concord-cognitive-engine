// server/migrations/091_world_buildings.js
//
// v2.0 instantiation: blueprint DTUs become spawned buildings in the
// world. The `world_buildings` table was created by migration 063 for
// hand-placed seed structures; this migration extends it with two
// nullable columns so player-spawned DTU blueprints can coexist with
// the seed-city geometry in one table.
//
// New columns:
//   blueprint_dtu_id     — references the DTU this building was spawned
//                          from (NULL for seed-city structures)
//   spawned_by_user_id   — who placed it (NULL for seed)
//   rotation_y           — yaw rotation in radians (parallel to existing
//                          `rotation` so we don't break old code; we use
//                          rotation_y on new spawns and the renderer
//                          falls back to rotation when null)
//
// The 091_world_buildings.js name predates this rewrite. Kept here so
// migration ordering stays linear and idempotent.

export function up(db) {
  // Idempotent ALTER TABLE — only adds columns that don't already exist.
  let cols = [];
  try {
    cols = db.prepare("PRAGMA table_info(world_buildings)").all().map((r) => r.name);
  } catch { return; /* table missing — nothing to do; will be created by 063 first */ }

  if (!cols.includes("blueprint_dtu_id")) {
    db.exec("ALTER TABLE world_buildings ADD COLUMN blueprint_dtu_id TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_world_buildings_blueprint ON world_buildings(blueprint_dtu_id)");
  }
  if (!cols.includes("spawned_by_user_id")) {
    db.exec("ALTER TABLE world_buildings ADD COLUMN spawned_by_user_id TEXT");
  }
  if (!cols.includes("rotation_y")) {
    db.exec("ALTER TABLE world_buildings ADD COLUMN rotation_y REAL DEFAULT 0");
  }
}

export function down(_db) { /* sqlite — keep on rollback */ }
