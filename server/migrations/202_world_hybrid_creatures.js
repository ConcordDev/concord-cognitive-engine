// server/migrations/202_world_hybrid_creatures.js
//
// Spawned hybrid creatures with their physics-validated 3D blueprint
// embedded inline so the frontend renderer can build a Three.js mesh
// from primitives (capsule torso, leg cylinders, wing planes, etc.)
// without re-deriving the body topology.
//
// The blueprint JSON is the output of generateCreature() —
// topology + parts + mass + heightM + gait + abilityFlavors + skillIds.
// It's stored once at spawn time; render code is purely reactive.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_hybrid_creatures (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      x               REAL NOT NULL DEFAULT 0,
      y               REAL NOT NULL DEFAULT 0,
      z               REAL NOT NULL DEFAULT 0,
      blueprint_json  TEXT NOT NULL,
      parent_a        TEXT,
      parent_b        TEXT,
      generation      INTEGER NOT NULL DEFAULT 1,
      stability       REAL NOT NULL DEFAULT 0.5,
      cross_world     INTEGER NOT NULL DEFAULT 0,
      alive           INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_hybrid_world_alive
      ON world_hybrid_creatures(world_id, alive);
    CREATE INDEX IF NOT EXISTS idx_hybrid_parents
      ON world_hybrid_creatures(parent_a, parent_b);
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
