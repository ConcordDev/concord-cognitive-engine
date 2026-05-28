// server/migrations/235_festivals.js
//
// Phase BB1 — annual festival calendar.
//
// The Concordia year is 42 days (6 seasons × 7 days each, Phase 5c).
// Festivals fire on (season_idx, day_in_season_start..day_in_season_end)
// windows and recur every year. Distinct from kingdom-decree 'festival'
// which is a ruler-issued 24h popularity bump — those are unchanged.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS festivals (
      id                     TEXT PRIMARY KEY,
      name                   TEXT NOT NULL,
      season_idx             INTEGER NOT NULL CHECK (season_idx BETWEEN 0 AND 5),
      day_in_season_start    INTEGER NOT NULL CHECK (day_in_season_start BETWEEN 0 AND 6),
      day_in_season_end      INTEGER NOT NULL CHECK (day_in_season_end BETWEEN 0 AND 6),
      repeats_yearly         INTEGER NOT NULL DEFAULT 1,
      decoration_tag         TEXT,
      content_pack           TEXT NOT NULL,
      created_at             INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS festival_active (
      festival_id   TEXT NOT NULL,
      world_id      TEXT NOT NULL,
      year_idx      INTEGER NOT NULL,
      started_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      ends_at       INTEGER NOT NULL,
      PRIMARY KEY (festival_id, world_id, year_idx)
    );
    CREATE INDEX IF NOT EXISTS idx_festival_active_ends
      ON festival_active(ends_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_festival_active_ends;
    DROP TABLE IF EXISTS festival_active;
    DROP TABLE IF EXISTS festivals;
  `);
}
