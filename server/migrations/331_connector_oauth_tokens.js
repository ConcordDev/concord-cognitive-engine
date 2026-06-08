// server/migrations/331_connector_oauth_tokens.js
//
// Track C — make external connectors REAL. The marquee gap the Sci-Fi
// Feasibility Map flagged: OAuth was sign-in/identity only (access/refresh
// tokens discarded) and integrations stored a fake `tok_${random}`. This adds
// the table that persists real per-user, per-connector OAuth tokens so a
// connector flow can actually call Google Calendar / Gmail / etc. on the
// user's behalf — with refresh-token rotation.
//
//   connector_oauth_tokens(user_id, connector_id) → access/refresh/expiry/scopes
//
// Forward-only; table-guarded so it's a no-op on minimal builds.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS connector_oauth_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      connector_id TEXT NOT NULL,            -- 'google', 'google_calendar', 'github', ...
      access_token TEXT NOT NULL,
      refresh_token TEXT,                    -- nullable: only if the provider returned one
      token_type TEXT DEFAULT 'Bearer',
      expires_at INTEGER,                    -- unix seconds; null = no known expiry
      scopes_json TEXT,                      -- JSON array of granted scopes
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_refreshed_at INTEGER,
      UNIQUE(user_id, connector_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_connector_tokens_user ON connector_oauth_tokens(user_id, connector_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_connector_tokens_expiry ON connector_oauth_tokens(expires_at)`);
}

export function down(db) {
  db.exec("DROP INDEX IF EXISTS idx_connector_tokens_expiry");
  db.exec("DROP INDEX IF EXISTS idx_connector_tokens_user");
  db.exec("DROP TABLE IF EXISTS connector_oauth_tokens");
}
