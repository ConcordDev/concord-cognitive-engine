// Migration 146 — Theme deferred (game-feel pass): async-cooperation
// player signs (Death Stranding pattern).
//
// Players can drop short-lived signposts in the world that other players
// see. One row per active sign, TTL ~7 days, soft-capped per user via
// the lib's MAX_ACTIVE_PER_USER (50). Five sign kinds at the substrate
// level: arrow / warning / praise / help / poi.
//
// Append-only.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_signs (
      id           TEXT PRIMARY KEY,
      world_id     TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      x            REAL NOT NULL,
      y            REAL NOT NULL DEFAULT 0,
      z            REAL NOT NULL,
      kind         TEXT NOT NULL CHECK (kind IN (
                     'arrow','warning','praise','help','poi'
                   )),
      message      TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_player_signs_world_pos
      ON player_signs(world_id, x, z);
    CREATE INDEX IF NOT EXISTS idx_player_signs_user_active
      ON player_signs(user_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_player_signs_expiry
      ON player_signs(expires_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_player_signs_world_pos;
    DROP INDEX IF EXISTS idx_player_signs_user_active;
    DROP INDEX IF EXISTS idx_player_signs_expiry;
    DROP TABLE IF EXISTS player_signs;
  `);
}
