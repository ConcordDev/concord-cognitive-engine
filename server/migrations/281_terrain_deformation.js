// server/migrations/281_terrain_deformation.js
//
// Living Society — Phase 0.6: destructible world (terrain-as-resource).
//
// Terrain was procedural-only, NOT persisted — a dug pit vanished on reload.
// We store only the DIFFS layered on the seed-regenerated base (keeps the
// world cheap/procedural; only pits/craters/raises persist):
//
//   - world_terrain_deformations(world_id, cell_x, cell_z, height_delta, kind,
//     material_id): the per-cell height delta over the seed base.
//   - world_water_cells(world_id, cell_x, cell_z, water_height): the per-cell
//     water column over base terrain — the load-bearing hydrology grid. The
//     flow solver moves water to the lowest adjacent cell, conserving volume.
//
// Both are PER-WORLD tables (write-owned by the world shard).

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

export function up(db) {
  if (!tableExists(db, "world_terrain_deformations")) {
    db.exec(`
      CREATE TABLE world_terrain_deformations (
        id           TEXT PRIMARY KEY,
        world_id     TEXT NOT NULL,
        cell_x       INTEGER NOT NULL,
        cell_z       INTEGER NOT NULL,
        height_delta REAL NOT NULL DEFAULT 0,
        kind         TEXT NOT NULL DEFAULT 'excavate'
                       CHECK (kind IN ('excavate','crater','raise')),
        material_id  TEXT,
        created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (world_id, cell_x, cell_z)
      );
      CREATE INDEX idx_terrain_deform_world ON world_terrain_deformations(world_id);
    `);
  }
  if (!tableExists(db, "world_water_cells")) {
    db.exec(`
      CREATE TABLE world_water_cells (
        world_id     TEXT NOT NULL,
        cell_x       INTEGER NOT NULL,
        cell_z       INTEGER NOT NULL,
        water_height REAL NOT NULL DEFAULT 0,
        updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (world_id, cell_x, cell_z)
      );
      CREATE INDEX idx_water_cells_world ON world_water_cells(world_id);
    `);
  }
}

export function down(_db) {
  // forward-only
}
