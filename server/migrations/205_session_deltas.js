// server/migrations/205_session_deltas.js
//
// Sprint C Item #10 — in-instance real-time studio collaboration.
//
// session_deltas is the per-edit log for a collaborative session
// DTU. Two clients on the same Concord instance subscribe to the
// `session:${sessionDtuId}` socket room; deltas append here and
// fan out via realtimeEmit so peers see edits within a frame.
//
// Append-only per the migration invariant.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_deltas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_dtu_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      delta_kind TEXT NOT NULL,
      delta_json TEXT NOT NULL,
      server_ts INTEGER NOT NULL DEFAULT (unixepoch()),
      client_ts INTEGER,
      origin_instance TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_session_deltas_session
      ON session_deltas(session_dtu_id, server_ts);
    CREATE INDEX IF NOT EXISTS idx_session_deltas_user
      ON session_deltas(user_id, server_ts DESC);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS session_deltas;`);
}
