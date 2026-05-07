// migrations/009_brain_want_engine.js
// Brain Prompts & Want Engine schema additions.
// Tables for: personality evolution, want engine state, spontaneous messages.
//
// NOTE (Phase 3.5.5 archival, May 2026):
//   The 8 tables in this migration (personality_state,
//   personality_evolution_log, wants, want_audit_log, want_suppressions,
//   spontaneous_queue, spontaneous_user_prefs, want_actions) are all
//   superseded by the persona + affect substrate. Cartographer pass-1
//   confirmed zero SELECT references in any .js file outside this
//   migration. CREATE TABLE IF NOT EXISTS preserved for idempotency on
//   existing DBs; new installs allocate but never read/write.
//   REPLACED_BY: persona domain (9 macros) + affect/engine.js (7-dim)
//                + persona macro substrate

export function up(db) {
  db.exec(`
    -- Personality evolution tracking
    -- Stores the evolving personality state and audit trail
    CREATE TABLE IF NOT EXISTS personality_state (
      id              TEXT PRIMARY KEY DEFAULT 'personality_main',
      humor_style     TEXT NOT NULL DEFAULT 'witty',
      verbosity_baseline    REAL NOT NULL DEFAULT 0.4,
      confidence_in_opinions REAL NOT NULL DEFAULT 0.5,
      curiosity_expression  REAL NOT NULL DEFAULT 0.5,
      formality       REAL NOT NULL DEFAULT 0.3,
      interaction_count INTEGER NOT NULL DEFAULT 0,
      preferred_metaphor_domains TEXT DEFAULT '[]',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Personality evolution log (append-only)
    CREATE TABLE IF NOT EXISTS personality_evolution_log (
      id              TEXT PRIMARY KEY,
      interaction_count INTEGER NOT NULL,
      changes_json    TEXT NOT NULL DEFAULT '{}',
      interaction_type TEXT,
      domain          TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Want engine: active and historical wants
    CREATE TABLE IF NOT EXISTS wants (
      id              TEXT PRIMARY KEY,
      type            TEXT NOT NULL,
      domain          TEXT NOT NULL,
      intensity       REAL NOT NULL DEFAULT 0.3,
      origin          TEXT NOT NULL,
      description     TEXT DEFAULT '',
      ceiling         REAL NOT NULL DEFAULT 0.85,
      decay_rate      REAL NOT NULL DEFAULT 0.02,
      satisfaction_events INTEGER NOT NULL DEFAULT 0,
      frustration_events INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'active',
      death_reason    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      last_acted_at   TEXT,
      last_satisfied_at TEXT,
      last_decayed_at TEXT,
      died_at         TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_wants_status ON wants(status);
    CREATE INDEX IF NOT EXISTS idx_wants_type ON wants(type);
    CREATE INDEX IF NOT EXISTS idx_wants_domain ON wants(domain);

    -- Want audit log (append-only, full transparency)
    CREATE TABLE IF NOT EXISTS want_audit_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      want_id         TEXT NOT NULL,
      action          TEXT NOT NULL,
      details_json    TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_want_audit_want_id ON want_audit_log(want_id);
    CREATE INDEX IF NOT EXISTS idx_want_audit_action ON want_audit_log(action);

    -- Suppressed wants (sovereign kill switch, permanent)
    CREATE TABLE IF NOT EXISTS want_suppressions (
      want_id         TEXT PRIMARY KEY,
      suppressed_at   TEXT NOT NULL DEFAULT (datetime('now')),
      reason          TEXT DEFAULT 'sovereign'
    );

    -- Spontaneous message queue
    CREATE TABLE IF NOT EXISTS spontaneous_queue (
      id              TEXT PRIMARY KEY,
      content         TEXT NOT NULL,
      reason          TEXT DEFAULT '',
      urgency         TEXT NOT NULL DEFAULT 'low',
      message_type    TEXT NOT NULL DEFAULT 'statement',
      user_id         TEXT,
      want_id         TEXT,
      source          TEXT NOT NULL DEFAULT 'subconscious',
      status          TEXT NOT NULL DEFAULT 'pending',
      formatted_content TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      delivered_at    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_spontaneous_status ON spontaneous_queue(status);
    CREATE INDEX IF NOT EXISTS idx_spontaneous_user ON spontaneous_queue(user_id);

    -- Spontaneous message user preferences
    CREATE TABLE IF NOT EXISTS spontaneous_user_prefs (
      user_id         TEXT PRIMARY KEY,
      enabled         INTEGER NOT NULL DEFAULT 1,
      daily_count     INTEGER NOT NULL DEFAULT 0,
      last_delivered_at TEXT,
      last_reset_date TEXT,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Want action tracking (for processing share limits)
    CREATE TABLE IF NOT EXISTS want_actions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      want_id         TEXT NOT NULL,
      action_type     TEXT NOT NULL DEFAULT 'processing',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_want_actions_want_id ON want_actions(want_id);
    CREATE INDEX IF NOT EXISTS idx_want_actions_created ON want_actions(created_at);
  `);
}
