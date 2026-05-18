// server/migrations/218_calendar_ai.js
//
// Calendar Sprint B — AI surface substrate.
//
// calendar_ai_runs — append-only ledger of every AI invocation
// (auto_schedule / parse_event / meeting_prep / daily_ritual /
// meeting_notes / voice / chat / semantic_search).
//
// calendar_focus_blocks — Reclaim-style time-defending: persistent
// recurring blocks that auto-schedule treats as immovable busy time.
//
// calendar_auto_schedule_settings — per-user preferences for the
// auto-scheduler (working hours, buffer minutes, weekend behaviour,
// minimum focus block size).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_ai_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id     TEXT,
      user_id      TEXT NOT NULL,
      kind         TEXT NOT NULL,
      prompt       TEXT,
      input_text   TEXT,
      output_text  TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT 'llm'
                   CHECK (source IN ('llm','fallback','deterministic')),
      latency_ms   INTEGER,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_cal_ai_user ON calendar_ai_runs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cal_ai_event ON calendar_ai_runs(event_id, created_at DESC) WHERE event_id IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_focus_blocks (
      id              TEXT PRIMARY KEY,
      owner_id        TEXT NOT NULL,
      title           TEXT NOT NULL,
      day_of_week     INTEGER,                        -- 0-6 (Sun-Sat); NULL = every day
      start_minute    INTEGER NOT NULL,               -- minutes since midnight
      end_minute      INTEGER NOT NULL,
      kind            TEXT NOT NULL DEFAULT 'focus'
                      CHECK (kind IN ('focus','dnd','habit','lunch','exercise','sleep')),
      color           TEXT DEFAULT '#8b5cf6',
      enabled         INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_focus_owner ON calendar_focus_blocks(owner_id, enabled);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_auto_schedule_settings (
      user_id            TEXT PRIMARY KEY,
      work_start_hour    INTEGER NOT NULL DEFAULT 9,    -- 0-23
      work_end_hour      INTEGER NOT NULL DEFAULT 17,
      buffer_minutes     INTEGER NOT NULL DEFAULT 15,    -- minutes between events
      min_focus_minutes  INTEGER NOT NULL DEFAULT 30,    -- smallest scheduled block
      include_weekends   INTEGER NOT NULL DEFAULT 0,
      max_meetings_per_day INTEGER NOT NULL DEFAULT 6,
      auto_decline_outside_hours INTEGER NOT NULL DEFAULT 0,
      preferences_json   TEXT,
      updated_at         INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS calendar_auto_schedule_settings;
    DROP TABLE IF EXISTS calendar_focus_blocks;
    DROP TABLE IF EXISTS calendar_ai_runs;
  `);
}
