// server/migrations/171_agent_marathon_sessions.js
//
// Sprint 12 — long-running marathon agent sessions.
//
// chat_agent.do caps at 5 turns per request. Marathon mode lets the
// agent run for hours/days against a persistent task: each tick
// resumes from the prior state, keeps unlimited shadow context, and
// can call all the same tools across many turns.
//
// Two tables:
//
//   agent_marathon_sessions — the persistent task itself
//     id, user_id, title, goal, status, total_turns, max_turns,
//     created_at, updated_at, completed_at
//
//   agent_marathon_turns — each turn's brain reply + tool calls + summary
//     id, session_id, turn_index, role, content, tool_calls_json,
//     artifacts_json, provider, model, created_at
//
// The chat_agent.do macro accepts an optional sessionId. When given,
// it loads the session's history, runs one or more turns, persists
// the new turns, and returns the updated state. The frontend can
// poll the session's progress by sessionId; a heartbeat module
// auto-resumes "running" sessions on a clock so they make progress
// even when the user closes the tab.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_marathon_sessions (
      id           TEXT    PRIMARY KEY,
      user_id      TEXT    NOT NULL,
      title        TEXT,
      goal         TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','running','paused','completed','failed','abandoned')),
      total_turns  INTEGER NOT NULL DEFAULT 0,
      max_turns    INTEGER NOT NULL DEFAULT 200,
      meta_json    TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER,
      next_tick_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_marathon_user ON agent_marathon_sessions(user_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_marathon_status ON agent_marathon_sessions(status, next_tick_at)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_marathon_turns (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT    NOT NULL,
      turn_index      INTEGER NOT NULL,
      role            TEXT    NOT NULL CHECK (role IN ('user','assistant','system','tool')),
      content         TEXT,
      tool_calls_json TEXT,
      artifacts_json  TEXT,
      provider        TEXT,
      model           TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_marathon_turns_session ON agent_marathon_turns(session_id, turn_index)`);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS agent_marathon_turns`);
  db.exec(`DROP TABLE IF EXISTS agent_marathon_sessions`);
}
