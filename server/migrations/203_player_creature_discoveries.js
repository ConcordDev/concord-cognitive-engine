// server/migrations/203_player_creature_discoveries.js
//
// Per-player log of creatures encountered, tamed, and bred. Mirrors the
// schema shape of `secrets_discovered` (migration 154) — one row per
// (user, species_ref, kind) with sightings counter and a first/last seen
// pair. Kinds:
//   'hybrid'   — procedurally bred crossbreed offspring (refs world_hybrid_creatures.id)
//   'authored' — content/world/*/bestiary.json species (refs species_id)
//   'tamed'    — wild creature the player tamed (refs player_companions.id)
//   'bred'     — child the player bred from two companions (refs world_hybrid_creatures.id)
//
// The same species can appear under multiple kinds (you can sight it,
// then tame it, then breed it) — the UNIQUE constraint is on the full
// (user_id, world_id, kind, species_ref) tuple.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_creature_discoveries (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      world_id        TEXT NOT NULL,
      kind            TEXT NOT NULL CHECK (kind IN ('hybrid','authored','tamed','bred')),
      species_ref     TEXT NOT NULL,
      first_seen_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      sightings       INTEGER NOT NULL DEFAULT 1,
      meta_json       TEXT,
      UNIQUE(user_id, world_id, kind, species_ref)
    );

    CREATE INDEX IF NOT EXISTS idx_pcd_user
      ON player_creature_discoveries(user_id, world_id);
    CREATE INDEX IF NOT EXISTS idx_pcd_kind
      ON player_creature_discoveries(user_id, kind);
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
