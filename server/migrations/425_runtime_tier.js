// server/migrations/425_runtime_tier.js
//
// P7/P8 — Mission↔marathon bridge + runtime tier tracking.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mission_marathon_links (
      mission_id    TEXT    PRIMARY KEY,
      marathon_id   TEXT    NOT NULL UNIQUE,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_mission_marathon_marathon
      ON mission_marathon_links(marathon_id);

    CREATE TABLE IF NOT EXISTS runtime_tier_state (
      id                  INTEGER PRIMARY KEY CHECK (id = 1),
      auth_gate_mode      TEXT    NOT NULL DEFAULT 'observe',
      enforce_autonomous  INTEGER NOT NULL DEFAULT 0,
      coding_loops_run    INTEGER NOT NULL DEFAULT 0,
      marathons_spawned   INTEGER NOT NULL DEFAULT 0,
      last_benchmark_at   INTEGER,
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
    INSERT OR IGNORE INTO runtime_tier_state (id) VALUES (1);
  `);
}
