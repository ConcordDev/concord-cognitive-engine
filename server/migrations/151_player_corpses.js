// Migration 148 — Theme deferred (game-feel pass): player corpses
// (Dark Souls "shadow corpse" recovery pattern).
//
// On death, a fraction of the player's coins are written to
// player_corpses at the death position. The player can return to that
// position to recover them; killed-again-before-recovery → corpse is
// permanently lost (per Dark Souls).
//
// Frontend renders a translucent marker at corpse position via the
// existing projector overlay pattern (same as DamageBillboard /
// WorldSigns); recover via runMacro playerCorpse.recover.
//
// Append-only.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_corpses (
      id            TEXT    PRIMARY KEY,
      world_id      TEXT    NOT NULL,
      user_id       TEXT    NOT NULL,
      x             REAL    NOT NULL,
      y             REAL    NOT NULL DEFAULT 0,
      z             REAL    NOT NULL,
      coins_held    INTEGER NOT NULL DEFAULT 0,
      cause         TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      recovered_at  INTEGER,
      lost_at       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pc_world_user_active
      ON player_corpses(world_id, user_id, recovered_at, lost_at);
    CREATE INDEX IF NOT EXISTS idx_pc_world_active
      ON player_corpses(world_id, recovered_at, lost_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_pc_world_active;
    DROP INDEX IF EXISTS idx_pc_world_user_active;
    DROP TABLE IF EXISTS player_corpses;
  `);
}
