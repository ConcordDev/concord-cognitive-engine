// server/migrations/056_messaging_adapters.js
// External messaging channel bindings, message log, and user-platform linking.
//
// NOTE (Phase 3.5.5 archival, May 2026):
//   `messaging_verification_codes` has zero SELECT references —
//   verification flow now uses session/JWT short-lived tokens directly.
//   Idempotent CREATE preserved.
//   REPLACED_BY: session-based verification in auth flow

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messaging_bindings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('whatsapp','telegram','discord','signal','imessage','slack','email')),
      external_id TEXT NOT NULL,
      display_name TEXT,
      verified INTEGER DEFAULT 0,
      verification_token TEXT,
      verified_at TEXT,
      permission_level TEXT DEFAULT 'standard' CHECK(permission_level IN ('restricted','standard','elevated')),
      preferred INTEGER DEFAULT 0,
      encrypted_credentials TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_bindings_external
      ON messaging_bindings(platform, external_id);
    CREATE INDEX IF NOT EXISTS idx_messaging_bindings_user
      ON messaging_bindings(user_id);

    CREATE TABLE IF NOT EXISTS messaging_messages (
      id TEXT PRIMARY KEY,
      binding_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
      external_message_id TEXT,
      content_text TEXT,
      content_json TEXT,
      dtu_id TEXT,
      agent_id TEXT,
      refusal_status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (binding_id) REFERENCES messaging_bindings(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messaging_messages_binding
      ON messaging_messages(binding_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messaging_messages_dtu
      ON messaging_messages(dtu_id);

    CREATE TABLE IF NOT EXISTS messaging_verification_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messaging_verification_user
      ON messaging_verification_codes(user_id, platform, expires_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS messaging_verification_codes;
    DROP TABLE IF EXISTS messaging_messages;
    DROP INDEX IF EXISTS idx_messaging_bindings_external;
    DROP TABLE IF EXISTS messaging_bindings;
  `);
}
