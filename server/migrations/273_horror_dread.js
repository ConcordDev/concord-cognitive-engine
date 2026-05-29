// Migration 273 — horror dread substrate (E1).
//
// Per-session, per-investigator atmosphere state: proximity-driven dread,
// chase state, and a health tier (healthy → wounded → downed) with a rally
// (comeback) path. The bare win-conditions live in horror_sessions; this is
// the tension layer that makes the mode feel like horror.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS horror_dread_state (
      session_id        TEXT NOT NULL,
      user_id           TEXT NOT NULL,
      dread             REAL NOT NULL DEFAULT 0,      -- 0..1
      pursuer_distance  REAL,                          -- last computed ghost distance (m)
      in_chase          INTEGER NOT NULL DEFAULT 0,    -- 1 while the ghost is within chase radius
      chase_started_at  INTEGER,
      health_tier       TEXT NOT NULL DEFAULT 'healthy'
                          CHECK (health_tier IN ('healthy','wounded','downed','rallied')),
      bleed_out_at      INTEGER,                       -- unixepoch when a downed investigator expires
      rallied_count     INTEGER NOT NULL DEFAULT 0,
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (session_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_horror_dread_session ON horror_dread_state(session_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_horror_dread_session;
    DROP TABLE IF EXISTS horror_dread_state;
  `);
}
