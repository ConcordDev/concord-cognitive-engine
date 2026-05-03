// server/migrations/091_world_buildings.js
//
// v2.0 instantiation: blueprint DTUs become spawned buildings in the world.
// `world_buildings` references a blueprint DTU plus a position; the 3D
// renderer walks this table on world load to render community-spawned
// structures. The blueprint DTU itself is the source of truth — this
// table is just (instance_id, blueprint_id, position) records.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_buildings (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      blueprint_dtu_id TEXT NOT NULL,
      spawned_by_user_id TEXT,
      x REAL NOT NULL,
      y REAL NOT NULL,
      z REAL NOT NULL,
      rotation_y REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_world_buildings_world ON world_buildings(world_id);
    CREATE INDEX IF NOT EXISTS idx_world_buildings_blueprint ON world_buildings(blueprint_dtu_id);
  `);
}

export function down(_db) { /* sqlite — keep table on rollback */ }
