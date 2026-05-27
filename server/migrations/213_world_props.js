// server/migrations/213_world_props.js
//
// Wave G1 — interactable world props substrate.
//
// Every world ships with placed props (chairs, mugs, torches, signposts,
// bookshelves, anvils, beds, wells, lanterns, banners, etc.) that a
// player can interact with via an animation + downstream effect.
//
// Two tables:
//   world_props           — per-world placed props with state
//   prop_interaction_log  — distance-gated, cooldown-rate-limited log
//
// Props are seeded from content/world/<world>/props.json by the content
// seeder (idempotent) and may also be spawned procedurally by district.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_props (
      id           TEXT    PRIMARY KEY,
      world_id     TEXT    NOT NULL,
      district     TEXT,
      prop_kind    TEXT    NOT NULL,
      x            REAL    NOT NULL,
      z            REAL    NOT NULL,
      y            REAL    NOT NULL DEFAULT 0,
      rotation     REAL    NOT NULL DEFAULT 0,
      variant      TEXT,
      durability   REAL    NOT NULL DEFAULT 1.0,
      state_json   TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_world_props_world
      ON world_props(world_id, district);
    CREATE INDEX IF NOT EXISTS idx_world_props_kind
      ON world_props(world_id, prop_kind);

    CREATE TABLE IF NOT EXISTS prop_interaction_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      prop_id   TEXT    NOT NULL,
      user_id   TEXT    NOT NULL,
      kind      TEXT    NOT NULL,
      at        INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_pil_prop_user
      ON prop_interaction_log(prop_id, user_id, at);
    CREATE INDEX IF NOT EXISTS idx_pil_user_recent
      ON prop_interaction_log(user_id, at);
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
