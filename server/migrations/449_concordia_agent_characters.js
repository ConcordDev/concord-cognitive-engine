// server/migrations/449_concordia_agent_characters.js
//
// AgentBody P0 — persistent Concord souls for Grok Bot / friend agents.
// affect_state is bound separately (entity_id = character id). This table
// holds appearance, charter, last pose, and needs_json. MCP is not a row.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS concordia_agent_characters (
      id TEXT PRIMARY KEY,
      assistant_id TEXT NOT NULL,
      user_id TEXT,
      appearance_json TEXT NOT NULL DEFAULT '{}',
      charter TEXT NOT NULL DEFAULT '',
      world_id TEXT NOT NULL DEFAULT 'concordia-hub',
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0.12,
      z REAL NOT NULL DEFAULT 0,
      yaw REAL NOT NULL DEFAULT 0,
      needs_json TEXT NOT NULL DEFAULT '{"hunger":0,"thirst":0,"energy":1,"comfort":0.7,"pain":0}',
      bound_session TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_chars_assistant ON concordia_agent_characters(assistant_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_chars_user ON concordia_agent_characters(user_id)`);
}
