// server/migrations/215_player_mail.js
//
// Phase U1 — async player-to-player mail (WoW-style).
//
// Distinct from social.js#sendMessage (in-memory instant DM):
//   - Survives logout
//   - Supports DTU + CC attachments
//   - Supports COD (cash-on-delivery) — the recipient pays a fee on claim,
//     and the proceeds flow to the sender
//   - 30-day expiry; expired mail returns attachments to sender via a
//     sweep heartbeat
//
// Status transitions: unread → read → claimed (attachments gone) → expired.
// Once claimed, the mail itself stays in inbox for history but the
// attachment_dtu_ids JSON is cleared.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_mail (
      id                  TEXT PRIMARY KEY,
      from_user_id        TEXT NOT NULL,
      to_user_id          TEXT NOT NULL,
      world_id            TEXT,
      subject             TEXT NOT NULL,
      body                TEXT NOT NULL DEFAULT '',
      status              TEXT NOT NULL DEFAULT 'unread'
                          CHECK (status IN ('unread','read','claimed','expired')),
      sent_at             INTEGER NOT NULL DEFAULT (unixepoch()),
      read_at             INTEGER,
      claimed_at          INTEGER,
      expires_at          INTEGER NOT NULL DEFAULT (unixepoch() + 30 * 86400),
      attachment_dtu_ids  TEXT NOT NULL DEFAULT '[]',
      attachment_cc       REAL NOT NULL DEFAULT 0,
      cod_cc              REAL NOT NULL DEFAULT 0,
      CHECK (from_user_id != to_user_id),
      CHECK (attachment_cc >= 0),
      CHECK (cod_cc >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_player_mail_inbox
      ON player_mail (to_user_id, status, sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_player_mail_outbox
      ON player_mail (from_user_id, sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_player_mail_expiry
      ON player_mail (status, expires_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_player_mail_expiry;
    DROP INDEX IF EXISTS idx_player_mail_outbox;
    DROP INDEX IF EXISTS idx_player_mail_inbox;
    DROP TABLE IF EXISTS player_mail;
  `);
}
