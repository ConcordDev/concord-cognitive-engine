// server/migrations/334_agent_action_log.js
//
// Phase 6 Tier 1 — agent long-term memory (the Mem0/Qdrant pattern). ConKay's
// past actions / tool outputs / verified answers are persisted here and retrieved
// on future turns so the agent grounds new work in what it actually did before —
// the cross-session memory it lacked (the substrate had episodic shadow-DTU
// memory + conversation compression, but no durable ACTION log).
//
// `embedding` is a BLOB of a Float32 vector (nomic-embed) for ANN-style recall;
// retrieval falls back to keyword + recency when embeddings are unavailable.
// Forward-only; table-guarded.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_action_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT,
      action TEXT NOT NULL,            -- e.g. 'code.build', 'reason.verify', a tool name
      input_json TEXT,                 -- compact input (truncated)
      output_summary TEXT,             -- compact result/outcome (truncated)
      tool TEXT,                       -- the tool/macro used, if any
      outcome TEXT,                    -- 'ok' | 'error' | free text
      embedding BLOB,                  -- Float32 vector of the action text (nullable)
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_action_user_time ON agent_action_log(user_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_action_session ON agent_action_log(user_id, session_id, created_at)`);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_agent_action_session`);
  db.exec(`DROP INDEX IF EXISTS idx_agent_action_user_time`);
  db.exec(`DROP TABLE IF EXISTS agent_action_log`);
}
