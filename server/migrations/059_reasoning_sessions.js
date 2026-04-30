// server/migrations/059_reasoning_sessions.js
// Ongoing shadow reasoning: session tracking and shadow DTU indexing.

export function up(db) {
  db.exec(`
    ALTER TABLE dtus ADD COLUMN ongoing_reasoning_session TEXT;
    ALTER TABLE dtus ADD COLUMN shadow_generation INTEGER;
    ALTER TABLE dtus ADD COLUMN reasoning_continues INTEGER DEFAULT 0;

    CREATE INDEX IF NOT EXISTS idx_dtus_ongoing_reasoning
      ON dtus(ongoing_reasoning_session, shadow_generation)
      WHERE ongoing_reasoning_session IS NOT NULL;

    CREATE TABLE IF NOT EXISTS reasoning_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      caller_id TEXT NOT NULL DEFAULT 'unknown',
      original_intent TEXT NOT NULL,
      brain_role TEXT NOT NULL DEFAULT 'conscious',
      shadow_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','synthesizing','complete','interrupted','failed')),
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_shadow_at TEXT,
      completed_at TEXT,
      final_response_dtu_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reasoning_sessions_caller
      ON reasoning_sessions(caller_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reasoning_sessions_active
      ON reasoning_sessions(status, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reasoning_sessions_user
      ON reasoning_sessions(user_id, started_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_reasoning_sessions_user;
    DROP INDEX IF EXISTS idx_reasoning_sessions_active;
    DROP INDEX IF EXISTS idx_reasoning_sessions_caller;
    DROP TABLE IF EXISTS reasoning_sessions;
    DROP INDEX IF EXISTS idx_dtus_ongoing_reasoning;
  `);
  // Note: SQLite doesn't support DROP COLUMN in older versions.
  // The added DTU columns remain but are harmless.
}
