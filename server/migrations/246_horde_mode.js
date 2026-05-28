// server/migrations/246_horde_mode.js
//
// Phase CB2 — bullet heaven horde mode.
//
// Combat + procedural-npc-spawner exist. Horde mode is: enter a zone,
// auto-attack on cooldown, exponential wave scaling, mid-run upgrade
// picker every wave. Steam officially named the genre "bullet heaven"
// in 2025 (Vampire Survivors).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS horde_runs (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      world_id        TEXT NOT NULL,
      started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at        INTEGER,
      end_reason      TEXT CHECK (end_reason IN ('death','timeout','manual')),
      wave_reached    INTEGER NOT NULL DEFAULT 0,
      kills           INTEGER NOT NULL DEFAULT 0,
      score           INTEGER NOT NULL DEFAULT 0,
      auto_attack     INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_horde_runs_user
      ON horde_runs(user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_horde_runs_active
      ON horde_runs(user_id) WHERE ended_at IS NULL;

    CREATE TABLE IF NOT EXISTS horde_upgrades (
      run_id        TEXT NOT NULL,
      slot_idx      INTEGER NOT NULL,
      upgrade_id    TEXT NOT NULL,
      picked_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (run_id, slot_idx)
    );
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS horde_upgrades;
    DROP INDEX IF EXISTS idx_horde_runs_active;
    DROP INDEX IF EXISTS idx_horde_runs_user;
    DROP TABLE IF EXISTS horde_runs;
  `);
}
