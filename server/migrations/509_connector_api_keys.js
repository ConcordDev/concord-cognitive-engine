// server/migrations/509_connector_api_keys.js
//
// FIX-integrations-003 — the encrypted per-user connector key store.
// api_key connectors (Airtable, Stripe) had no stored-key path at all:
// connectApp refused every connect with "credential required" and the
// catalog offered no entry step. This table persists a user's API key
// per connector, encrypted at rest with the platform's existing scheme
// (server/lib/connector-tokens.js: AES-256-GCM, enc:v1 format, key
// derived from the deployment secret). Only the last four characters
// are kept in cleartext (key_hint) so the UI can show "••••1234"
// without decrypting; the full key is never returned by any action.
//
// A DEDICATED table, not connector_oauth_tokens: API keys have no
// refresh/expiry semantics, and the OAuth refresh machinery must never
// mistake a static key for a refreshable token.
//
// Forward-only; table-guarded so it's a no-op on minimal builds.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS connector_api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      connector_id TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      key_hint TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, connector_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_connector_api_keys_user ON connector_api_keys(user_id, connector_id)`);
}

export function down(db) {
  db.exec("DROP INDEX IF EXISTS idx_connector_api_keys_user");
  db.exec("DROP TABLE IF EXISTS connector_api_keys");
}
