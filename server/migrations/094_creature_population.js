// server/migrations/094_creature_population.js
//
// EvoEcosystem: per-biome ambient fauna populations. The fauna-spawner
// heartbeat module reads this table to know which species exist in a
// (world_id, biome) and tops them up to a target population.
//
// Loot drops + corpses live in the existing world_npcs + death_loot_bags
// tables, which already work for PvP. We just plug creature deaths into
// the same pipeline.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creature_population (
      id                 TEXT PRIMARY KEY,
      world_id           TEXT NOT NULL,
      biome              TEXT NOT NULL,
      species_id         TEXT NOT NULL,
      blueprint_dtu_id   TEXT,
      target_count       INTEGER NOT NULL DEFAULT 0,
      current_count      INTEGER NOT NULL DEFAULT 0,
      lifestyle          TEXT NOT NULL DEFAULT 'herbivore',
      last_tick_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(world_id, biome, species_id)
    );

    CREATE INDEX IF NOT EXISTS idx_creature_pop_biome
      ON creature_population(world_id, biome);

    -- Per-corpse loot table reference. When a creature NPC dies, we
    -- write a row here pointing at the loot table to roll. The existing
    -- death_loot_bags table absorbs the rolled items.
    CREATE TABLE IF NOT EXISTS creature_corpses (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      species_id      TEXT NOT NULL,
      killer_user_id  TEXT,
      x REAL, y REAL, z REAL,
      claimed         INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at      INTEGER NOT NULL DEFAULT (unixepoch() + 1800)
    );

    CREATE INDEX IF NOT EXISTS idx_corpses_world ON creature_corpses(world_id);
    CREATE INDEX IF NOT EXISTS idx_corpses_killer ON creature_corpses(killer_user_id);
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
