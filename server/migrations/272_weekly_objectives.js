// Migration 272 — weekly meta objectives (D2 / retention legibility).
//
// A per-user, per-ISO-week objective chain. Progress is bumped by real
// gameplay events (via the achievement bridge), reward CC is claimed once
// when an objective completes, and the chain "resets" implicitly because
// each row is scoped by week_key — a new week seeds a fresh zero-progress set.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_objectives (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      week_key      TEXT NOT NULL,          -- e.g. '2026-W22'
      objective_id  TEXT NOT NULL,          -- catalog id
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      kind          TEXT NOT NULL,          -- progress event kind
      progress      INTEGER NOT NULL DEFAULT 0,
      target        INTEGER NOT NULL,
      reward_cc     REAL NOT NULL DEFAULT 0,
      completed_at  INTEGER,                -- unixepoch when target reached
      claimed_at    INTEGER,                -- unixepoch when reward credited
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_obj_user_week_obj
      ON weekly_objectives(user_id, week_key, objective_id);
    CREATE INDEX IF NOT EXISTS idx_weekly_obj_user_week
      ON weekly_objectives(user_id, week_key);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_weekly_obj_user_week;
    DROP INDEX IF EXISTS idx_weekly_obj_user_week_obj;
    DROP TABLE IF EXISTS weekly_objectives;
  `);
}
