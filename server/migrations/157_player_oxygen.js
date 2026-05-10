// Migration 157 — Sprint C / Track C4: player oxygen + max-depth tracking.
//
// One row per (user, world). oxygen_pct decays at 1%/sec while
// swim_depth > 0.3m, refills at 5%/sec at the surface. At <30%, sonic_os
// signals trigger a low-oxygen tone. At 0% applies drowning damage.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_oxygen (
      user_id            TEXT    NOT NULL,
      world_id           TEXT    NOT NULL,
      oxygen_pct         REAL    NOT NULL DEFAULT 100.0
                                  CHECK (oxygen_pct BETWEEN 0.0 AND 100.0),
      last_breath_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      max_depth_explored REAL    NOT NULL DEFAULT 0.0,
      drowning_damage    INTEGER NOT NULL DEFAULT 0,
      updated_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, world_id)
    );
    CREATE INDEX IF NOT EXISTS idx_oxygen_world ON player_oxygen(world_id);
  `);
}

export function down(_db) {
  // Forward-only.
}
