// server/migrations/256_asymmetric_horror.js
//
// Phase CC6 — asymmetric horror (Phasmophobia / Dead by Daylight).
//
// Inverts Sovereign Mass Raid: one ghost-player vs many investigators.
// Ghost has stealth movement; investigators win by photographing /
// citing evidence; ghost wins by downing all investigators.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS horror_sessions (
      id                      TEXT PRIMARY KEY,
      world_id                TEXT NOT NULL,
      ghost_user_id           TEXT NOT NULL,
      started_at              INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at                INTEGER,
      end_reason              TEXT CHECK (end_reason IN ('ghost_won','investigators_won','timeout','cancelled')),
      max_duration_s          INTEGER NOT NULL DEFAULT 1800,
      investigators_json      TEXT NOT NULL DEFAULT '[]',
      downed_investigators_json TEXT NOT NULL DEFAULT '[]',
      evidence_collected_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_horror_active
      ON horror_sessions(world_id) WHERE ended_at IS NULL;

    CREATE TABLE IF NOT EXISTS horror_sightings (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      x               REAL NOT NULL,
      y               REAL NOT NULL,
      z               REAL NOT NULL,
      sighting_kind   TEXT NOT NULL,
      ts              INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS horror_sightings;
    DROP INDEX IF EXISTS idx_horror_active;
    DROP TABLE IF EXISTS horror_sessions;
  `);
}
