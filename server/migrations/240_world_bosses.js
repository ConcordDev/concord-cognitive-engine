// server/migrations/240_world_bosses.js
//
// Phase BD1 — world boss scheduler + lockout.
//
// boss-phases.js is a generalized phase wrapper; sovereign-raid-event
// is a single-instance manual trigger. This adds the scheduler so
// world bosses spawn on a cadence + lockout players post-defeat.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_boss_schedule (
      id                        TEXT PRIMARY KEY,
      world_id                  TEXT NOT NULL,
      boss_template             TEXT NOT NULL,
      schedule_cron             TEXT,
      cadence_seconds           INTEGER NOT NULL DEFAULT 86400,
      next_spawn_at             INTEGER NOT NULL,
      difficulty_tier_default   TEXT NOT NULL DEFAULT 'normal',
      last_spawn_at             INTEGER,
      enabled                   INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_wbs_world ON world_boss_schedule(world_id);
    CREATE INDEX IF NOT EXISTS idx_wbs_next ON world_boss_schedule(next_spawn_at) WHERE enabled = 1;

    CREATE TABLE IF NOT EXISTS world_boss_active (
      id                  TEXT PRIMARY KEY,
      schedule_id         TEXT NOT NULL,
      world_id            TEXT NOT NULL,
      boss_template       TEXT NOT NULL,
      difficulty_tier     TEXT NOT NULL DEFAULT 'normal',
      opened_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      closes_at           INTEGER NOT NULL,
      status              TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','defeated','expired'))
    );
    CREATE INDEX IF NOT EXISTS idx_wba_world_status
      ON world_boss_active(world_id, status);

    CREATE TABLE IF NOT EXISTS world_boss_lockouts (
      user_id          TEXT NOT NULL,
      schedule_id      TEXT NOT NULL,
      locked_until     INTEGER NOT NULL,
      PRIMARY KEY (user_id, schedule_id)
    );
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS world_boss_lockouts;
    DROP INDEX IF EXISTS idx_wba_world_status;
    DROP TABLE IF EXISTS world_boss_active;
    DROP INDEX IF EXISTS idx_wbs_next;
    DROP INDEX IF EXISTS idx_wbs_world;
    DROP TABLE IF EXISTS world_boss_schedule;
  `);
}
