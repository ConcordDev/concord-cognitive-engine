// server/migrations/193_chat_sessions.js
//
// Chat session persistence — keeps multi-turn conversations alive across
// server restarts.
//
// Pre-this-migration `STATE.sessions` was an in-memory Map only. Frontend
// localStorage made it look like history survived (the sidebar still
// showed yesterday's conversations) but the brain saw no prior context
// because the backend session was wiped on restart. Users would ask a
// follow-up to a 2-day-old conversation and Concord would treat it as
// turn 1.
//
// Two tables, append-only:
//
//   chat_sessions   — one row per (sessionId). Tracks owner + title +
//                     last lens + timestamps. The owner gate matches the
//                     existing assertSessionAccessible() defense-in-depth
//                     in server.js.
//
//   chat_messages   — one row per turn. Stores role + content + the
//                     enriched meta (toolCalls, computed-from, dtuRefs,
//                     sources) so the surface can re-render a turn
//                     identically after rehydration.
//
// Indexes:
//   - (session_id, ts) for chronological replay
//   - (owner_id, updated_at DESC) for sidebar "recent conversations"
//
// Caller protocol (wired in server.js chat path):
//   - On chat.respond, after pushing to STATE.sessions, also insert the
//     user msg + assistant msg via persistChatTurn().
//   - On first STATE.sessions.has(sessionId) miss, hydrateSession()
//     pulls the last N messages from chat_messages and seeds the in-mem
//     session, so the brain sees the prior context.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      session_id   TEXT PRIMARY KEY,
      owner_id     TEXT,
      title        TEXT,
      last_lens    TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      msg_count    INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT NOT NULL,
      role         TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content      TEXT NOT NULL,
      ts           INTEGER NOT NULL,
      meta_json    TEXT,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_session_ts ON chat_messages(session_id, ts)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_owner_updated ON chat_sessions(owner_id, updated_at DESC)`);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_chat_sessions_owner_updated`);
  db.exec(`DROP INDEX IF EXISTS idx_chat_messages_session_ts`);
  db.exec(`DROP TABLE IF EXISTS chat_messages`);
  db.exec(`DROP TABLE IF EXISTS chat_sessions`);
}
