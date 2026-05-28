// server/migrations/245_roguelite_runs.js
//
// Phase CB1 — roguelite meta-progression.
//
// procgen-regions (Phase 5e) already spawn biome-themed wilderness from
// drift alerts. lattice-quest-cycle realizes the regions on quest
// completion. The missing piece: the "run" — entering a region marks
// the start, exit OR death ends the run, meta-currency banks,
// persistent unlocks gate item access on future runs (Hades pattern).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roguelite_runs (
      id                    TEXT PRIMARY KEY,
      user_id               TEXT NOT NULL,
      started_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at              INTEGER,
      end_reason            TEXT CHECK (end_reason IN ('death','extract','timeout','manual_exit')),
      world_id              TEXT NOT NULL,
      region_id             TEXT NOT NULL,
      meta_currency_earned  REAL NOT NULL DEFAULT 0,
      depth_reached         INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_roguelite_runs_user
      ON roguelite_runs(user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_roguelite_runs_active
      ON roguelite_runs(user_id) WHERE ended_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_roguelite_runs_region
      ON roguelite_runs(region_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS roguelite_meta_currency (
      user_id   TEXT PRIMARY KEY,
      balance   REAL NOT NULL DEFAULT 0,
      lifetime  REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS roguelite_unlocks (
      user_id      TEXT NOT NULL,
      unlock_id    TEXT NOT NULL,
      unlocked_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      cost_paid    REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, unlock_id)
    );
    CREATE INDEX IF NOT EXISTS idx_roguelite_unlocks_user
      ON roguelite_unlocks(user_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_roguelite_unlocks_user;
    DROP TABLE IF EXISTS roguelite_unlocks;
    DROP TABLE IF EXISTS roguelite_meta_currency;
    DROP INDEX IF EXISTS idx_roguelite_runs_region;
    DROP INDEX IF EXISTS idx_roguelite_runs_active;
    DROP INDEX IF EXISTS idx_roguelite_runs_user;
    DROP TABLE IF EXISTS roguelite_runs;
  `);
}
