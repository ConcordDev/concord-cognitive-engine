// server/migrations/184_creature_homes.js
//
// Phase 6 — animal homes + sleep patterns + ecology quest spawning.
//
// Three tables that the user-noted "where do bears sleep in Skyrim?"
// problem deserves:
//
//   creature_homes
//     One row per (world_id, biome, species_id) registering a home
//     anchor — a cave / nest / burrow / den / lair location. Spawner
//     uses this as the cluster center for sleeping/resting creatures
//     during the species' off-hours. Deterministic anchor per
//     (world, biome, species) so the home stays put across restarts.
//
//   creature_sleep_patterns
//     Per-species circadian schedule. Stores `active_phase` (diurnal /
//     nocturnal / crepuscular / cathemeral), a start/end hour in 0..23
//     for active hours, and `is_hibernator` flag. The fauna spawner
//     reads this to decide whether to spawn at-home or at-roam in the
//     current world tick.
//
//   ecology_imbalance_log
//     Append-only record of predator-prey imbalance moments. When the
//     fauna-spawner detects N consecutive ticks where prey_count <
//     prey_target * 0.3 AND predator_count > predator_target * 1.5,
//     it inserts a row; the lattice-quest-cycle consumes the row to
//     compose a "thin the predators" procedural quest.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creature_homes (
      id            TEXT PRIMARY KEY,
      world_id      TEXT NOT NULL,
      biome         TEXT NOT NULL,
      species_id    TEXT NOT NULL,
      kind          TEXT NOT NULL DEFAULT 'den'
                          CHECK (kind IN ('den', 'cave', 'nest', 'burrow', 'lair', 'roost', 'warren')),
      x             REAL NOT NULL,
      y             REAL NOT NULL DEFAULT 0,
      z             REAL NOT NULL,
      capacity      INTEGER NOT NULL DEFAULT 5,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_creature_homes_world  ON creature_homes(world_id);
    CREATE INDEX IF NOT EXISTS idx_creature_homes_keyed  ON creature_homes(world_id, biome, species_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_creature_home ON creature_homes(world_id, biome, species_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS creature_sleep_patterns (
      species_id    TEXT PRIMARY KEY,
      active_phase  TEXT NOT NULL DEFAULT 'diurnal'
                          CHECK (active_phase IN
                            ('diurnal', 'nocturnal', 'crepuscular', 'cathemeral')),
      active_start_hour INTEGER NOT NULL DEFAULT 6
                            CHECK (active_start_hour BETWEEN 0 AND 23),
      active_end_hour   INTEGER NOT NULL DEFAULT 20
                            CHECK (active_end_hour BETWEEN 0 AND 23),
      is_hibernator     INTEGER NOT NULL DEFAULT 0
                            CHECK (is_hibernator IN (0, 1)),
      hibernate_months  TEXT  -- JSON array of month indexes 0..11 when hibernating
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ecology_imbalance_log (
      id            TEXT PRIMARY KEY,
      world_id      TEXT NOT NULL,
      biome         TEXT NOT NULL,
      kind          TEXT NOT NULL CHECK (kind IN
                          ('predator_excess', 'prey_collapse', 'overpopulation', 'mass_die_off')),
      severity      INTEGER NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
      summary       TEXT NOT NULL,
      signature     TEXT NOT NULL, -- sha1 hash for dedupe
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ecology_world      ON ecology_imbalance_log(world_id, resolved_at);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_ecology_sig ON ecology_imbalance_log(signature);
  `);
}

export function down(_db) {
  // Forward-only — ecology history is the substrate.
}
