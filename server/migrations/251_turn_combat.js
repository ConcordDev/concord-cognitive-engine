// server/migrations/251_turn_combat.js
//
// Phase CC1 — turn-based grid combat (Tactical/CRPG mode).
//
// Real-time combat in routes/worlds.js is unchanged. This adds a
// parallel turn-based mode the player can opt into via a session.
// Reuses nav-grid for movement and combat-polish profiles for damage
// formulas. Same _validateDamageCap applies.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS turn_combats (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      mode            TEXT NOT NULL DEFAULT 'tactical'
                        CHECK (mode IN ('tactical', 'crpg')),
      started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at        INTEGER,
      winner_team     TEXT,
      current_turn    INTEGER NOT NULL DEFAULT 0,
      profile_name    TEXT NOT NULL DEFAULT 'sifu_brawler'
    );
    CREATE TABLE IF NOT EXISTS turn_combatants (
      combat_id        TEXT NOT NULL,
      entity_kind      TEXT NOT NULL CHECK (entity_kind IN ('player','npc')),
      entity_id        TEXT NOT NULL,
      team             TEXT NOT NULL,
      initiative_roll  INTEGER NOT NULL,
      hp               REAL NOT NULL,
      max_hp           REAL NOT NULL,
      ap_remaining     INTEGER NOT NULL DEFAULT 4,
      position_x       INTEGER NOT NULL DEFAULT 0,
      position_y       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (combat_id, entity_id)
    );
    CREATE TABLE IF NOT EXISTS turn_log (
      id            TEXT PRIMARY KEY,
      combat_id     TEXT NOT NULL,
      turn_idx      INTEGER NOT NULL,
      actor_id      TEXT NOT NULL,
      action        TEXT NOT NULL,
      target_id     TEXT,
      damage        REAL,
      ts            INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_turn_log_combat ON turn_log(combat_id, turn_idx);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_turn_log_combat;
    DROP TABLE IF EXISTS turn_log;
    DROP TABLE IF EXISTS turn_combatants;
    DROP TABLE IF EXISTS turn_combats;
  `);
}
