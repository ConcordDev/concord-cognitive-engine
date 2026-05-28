// server/migrations/244_climbing_routes.js
//
// Phase CA3 — climbing routes + achievements.
//
// player-stamina.js already exposes a "climbing" state with
// DRAIN_CLIMBING per tick + an exhausted-state gate that blocks re-entry.
// This adds a per-route ledger so achievements like first_summit and
// cliff_master can fire.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS climbing_routes (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      world_id        TEXT NOT NULL,
      start_x         REAL NOT NULL,
      start_y         REAL NOT NULL,
      start_z         REAL NOT NULL,
      end_x           REAL NOT NULL,
      end_y           REAL NOT NULL,
      end_z           REAL NOT NULL,
      peak_altitude   REAL NOT NULL,
      height_climbed  REAL NOT NULL,
      duration_s      INTEGER NOT NULL,
      completed_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_climbing_routes_user
      ON climbing_routes(user_id, completed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_climbing_routes_world
      ON climbing_routes(world_id, height_climbed DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_climbing_routes_world;
    DROP INDEX IF EXISTS idx_climbing_routes_user;
    DROP TABLE IF EXISTS climbing_routes;
  `);
}
