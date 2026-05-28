// server/migrations/218_player_faction_rep_cache.js
//
// Phase U4 — aggregate per-faction reputation cache.
//
// character_opinions (migration 153) is per-NPC-per-target. Summing
// rows for each (player, faction) lookup is expensive at scale, so we
// keep a cache refreshed by a heartbeat. The aggregate matters for
// dialogue gates ("Honored with Order of the Risen unlocks the Inner
// Sanctuary").

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_faction_reputation_cache (
      user_id       TEXT NOT NULL,
      world_id      TEXT NOT NULL,
      faction_id    TEXT NOT NULL,
      score         REAL NOT NULL DEFAULT 0,
      tier          TEXT NOT NULL DEFAULT 'neutral'
                    CHECK (tier IN ('hated','hostile','neutral','friendly','honored','exalted')),
      opinion_count INTEGER NOT NULL DEFAULT 0,
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, world_id, faction_id)
    );

    CREATE INDEX IF NOT EXISTS idx_player_faction_rep_user
      ON player_faction_reputation_cache(user_id, tier);
    CREATE INDEX IF NOT EXISTS idx_player_faction_rep_world
      ON player_faction_reputation_cache(world_id, faction_id, tier);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_player_faction_rep_world;
    DROP INDEX IF EXISTS idx_player_faction_rep_user;
    DROP TABLE IF EXISTS player_faction_reputation_cache;
  `);
}
