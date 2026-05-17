// server/migrations/195_lens_sessions.js
//
// Phase 5 of the 10-dimension UX completeness sprint — multi-step
// workflow sessions.
//
// Drafts (migration 194) cover single-field auto-save. Sessions cover
// multi-step / multi-day flows: "open a kingdoms war-campaign, plan
// for 3 sessions across a week, close it out." The user can leave a
// session open, come back tomorrow, resume the same step with the
// same context. The lens owns the step graph; this table just persists
// state, current step, and a transition log per session.
//
// Two tables, append-only:
//
//   lens_sessions — one row per active session. Belongs to (user_id,
//                   lens_id). Holds opaque state JSON, current step,
//                   status (open|paused|completed|abandoned), and
//                   timestamps.
//
//   lens_session_events — append-only ledger of step transitions and
//                   payload mutations. Lets the UI render a timeline
//                   ("opened Monday, advanced to plan-step Tuesday,
//                   completed Friday") without parsing diffs from
//                   payload snapshots.
//
// Indexes:
//   - lens_sessions: (user_id, lens_id, status) for the "my open
//     sessions" list; (updated_at) for GC sweep of abandoned >90d.
//   - lens_session_events: (session_id, created_at) for the event log.
//
// Caller protocol (useLensSession hook):
//   - sessions.start          → creates a session, returns its id.
//   - sessions.advance        → step transition + appends event.
//   - sessions.update_state   → merges into state_json (deep-merge);
//                               does NOT change step.
//   - sessions.get            → load session + recent events.
//   - sessions.list_mine      → caller's open sessions across lenses.
//   - sessions.close          → status='completed' or 'abandoned'.
//
// State JSON capped at 1 MiB.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lens_sessions (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      lens_id         TEXT NOT NULL,
      title           TEXT,
      status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paused','completed','abandoned')),
      current_step    TEXT,
      state_json      TEXT NOT NULL DEFAULT '{}',
      step_count      INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      closed_at       INTEGER
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_lens_sessions_user_lens_status ON lens_sessions(user_id, lens_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lens_sessions_user_status     ON lens_sessions(user_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lens_sessions_updated_at      ON lens_sessions(updated_at)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS lens_session_events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL,
      event_kind      TEXT NOT NULL CHECK (event_kind IN ('started','advanced','state_merged','paused','resumed','completed','abandoned','annotated')),
      from_step       TEXT,
      to_step         TEXT,
      note            TEXT,
      payload_json    TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (session_id) REFERENCES lens_sessions(id) ON DELETE CASCADE
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_lens_session_events_session ON lens_session_events(session_id, created_at)`);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_lens_session_events_session`);
  db.exec(`DROP TABLE IF EXISTS lens_session_events`);
  db.exec(`DROP INDEX IF EXISTS idx_lens_sessions_updated_at`);
  db.exec(`DROP INDEX IF EXISTS idx_lens_sessions_user_status`);
  db.exec(`DROP INDEX IF EXISTS idx_lens_sessions_user_lens_status`);
  db.exec(`DROP TABLE IF EXISTS lens_sessions`);
}
