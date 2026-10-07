// server/migrations/461_cognition_traces.js
//
// An opened trace survives a process restart. cognitionLens is an
// in-memory Map and is not on the shared lens-state key list. This
// table is the read-back for listExports and getExport. Mode and
// traceId stay inside the stored trace, so a restart does not invent them.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cognition_traces (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      note TEXT NOT NULL,
      trace_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cognition_traces_user
      ON cognition_traces (user_id, created_at);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS cognition_traces");
}
