// server/migrations/258_extraction_runs.js
//
// Phase CC8 — extraction shooter (Tarkov-lite).
//
// You run with a stash, pick up loot during the run, must reach an
// extraction zone before dying or timing out. Death drops your run
// loot as a player_corpse (reusing Phase 5d D2 substrate). Successful
// extraction banks loot to inventory.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS extraction_runs (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      world_id        TEXT NOT NULL,
      started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at        INTEGER,
      end_reason      TEXT CHECK (end_reason IN ('extracted','died','timeout','manual')),
      run_stash_json  TEXT NOT NULL DEFAULT '[]',
      lost_loot_json  TEXT NOT NULL DEFAULT '[]',
      timeout_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_extr_runs_user
      ON extraction_runs(user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_extr_runs_active
      ON extraction_runs(user_id) WHERE ended_at IS NULL;

    CREATE TABLE IF NOT EXISTS extraction_zones (
      id            TEXT PRIMARY KEY,
      world_id      TEXT NOT NULL,
      x             REAL NOT NULL,
      z             REAL NOT NULL,
      radius_m      REAL NOT NULL DEFAULT 8.0,
      active_until  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_extr_zones_world
      ON extraction_zones(world_id, active_until);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_extr_zones_world;
    DROP TABLE IF EXISTS extraction_zones;
    DROP INDEX IF EXISTS idx_extr_runs_active;
    DROP INDEX IF EXISTS idx_extr_runs_user;
    DROP TABLE IF EXISTS extraction_runs;
  `);
}
