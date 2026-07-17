// server/migrations/366_asset_studio_building.js
//
// Asset Studio increment 1 (Unit 1 — backend + migration). The game-design
// lens's new "Asset Studio" authors a parametric building
// (`createBuilding(THREE, opts)` in
// concord-frontend/lib/world-lens/procedural-buildings.ts) and publishes it
// as a real, creator-attributed blueprint DTU that spawns as a live
// `world_buildings` row. The in-world renderer (BuildingRenderer3D.tsx:151-
// 209) already reads `dtu.archetype` / `dtu.feature` off the mapped row —
// this migration is the two nullable columns that let a `world_buildings`
// row actually carry that vocabulary through from the authored blueprint,
// alongside the existing `building_type`/width/height/depth/
// blueprint_dtu_id/spawned_by_user_id columns from migrations 063/091.
//
// Additive + nullable, so every existing seed/lens-spawned building (which
// never set these columns) is byte-identical: `archetype`/`feature` stay
// NULL for them and BuildingRenderer3D's existing archetype-from-
// building_type derivation path is untouched.

export function up(db) {
  // Idempotent ALTER TABLE — only adds columns that don't already exist,
  // same guard idiom as migration 091_world_buildings.js.
  let cols = [];
  try {
    cols = db.prepare("PRAGMA table_info(world_buildings)").all().map((r) => r.name);
  } catch { return; /* table missing — nothing to do; created by 063 first */ }

  if (!cols.includes("archetype")) {
    db.exec("ALTER TABLE world_buildings ADD COLUMN archetype TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_world_buildings_archetype ON world_buildings(archetype)");
  }
  if (!cols.includes("feature")) {
    db.exec("ALTER TABLE world_buildings ADD COLUMN feature TEXT");
  }
}

export function down(_db) { /* sqlite — keep on rollback */ }
