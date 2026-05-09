// Migration 134 — Phase 5c: Seasons + Long-cycle Time.
//
// 6 in-game seasons, each = 7 real-world days (≈ 6 weeks per Concordia
// year). Seasons drive ambient temperature/humidity/light bias on top
// of Layer 7's per-cell signals, modulate gather-node yield (winter
// freezes herb), and produce annual events.
//
// Tables:
//   world_seasons    — current season per world (singleton row, upserted)
//   season_events    — append-only ledger of every season transition

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_seasons (
      world_id      TEXT    PRIMARY KEY,
      season_idx    INTEGER NOT NULL CHECK (season_idx BETWEEN 0 AND 5),
      year_n        INTEGER NOT NULL DEFAULT 1,
      transitioned_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS season_events (
      id            TEXT    PRIMARY KEY,
      world_id      TEXT    NOT NULL,
      season_idx    INTEGER NOT NULL,
      year_n        INTEGER NOT NULL,
      event_kind    TEXT    NOT NULL,
      narrative     TEXT,
      occurred_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_season_evt_world ON season_events(world_id, occurred_at);
  `);
}

export function down(_db) { /* forward-only */ }
