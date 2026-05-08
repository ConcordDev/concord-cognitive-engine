// server/migrations/059_reasoning_sessions.js
// Ongoing shadow reasoning: session tracking and shadow DTU indexing.
//
// NOTE (Phase 3.5.5 archival, May 2026):
//   `reasoning_sessions` has zero SELECT references — superseded by
//   the HLR engine's in-memory trace store + reasoning-trace persistence.
//   Idempotent CREATE preserved.
//   REPLACED_BY: emergent/hlr-engine.js trace store + listTraces macro

export function up(db) {
  // ALTER TABLE statements must run individually in SQLite
  const columns = db.prepare("PRAGMA table_info(dtus)").all().map(c => c.name);

  if (!columns.includes('ongoing_reasoning_session')) {
    db.exec(`ALTER TABLE dtus ADD COLUMN ongoing_reasoning_session TEXT`);
  }
  if (!columns.includes('shadow_generation')) {
    db.exec(`ALTER TABLE dtus ADD COLUMN shadow_generation INTEGER`);
  }
  if (!columns.includes('reasoning_continues')) {
    db.exec(`ALTER TABLE dtus ADD COLUMN reasoning_continues INTEGER DEFAULT 0`);
  }

  db.exec(`
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
}
