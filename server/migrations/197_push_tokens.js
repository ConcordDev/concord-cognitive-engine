// server/migrations/197_push_tokens.js
//
// Phase 11 (Item 13) — push notification tokens.
//
// Lets the server fan a single notification out to a user's
// registered devices (iOS / Android via Expo, browser via WebPush).
// Without this table, the NotificationBell + the new social toast
// only fire while the app is in the foreground; users miss
// reactions / mentions / DMs the moment they close the tab.
//
// One table:
//
//   push_tokens — one row per (user_id, token).  Tracks platform,
//                 device label, last-used timestamp, and an
//                 optional expiry. The unique constraint stops a
//                 single device from registering twice; the
//                 last_used_at gets bumped on every successful send
//                 so we can GC stale rows.
//
// Indexes:
//   - (user_id) for fan-out lookup
//   - (token) for invalid-token purge on 410 Gone responses
//   - (last_used_at) for GC sweep of dormant tokens
//
// Honest discipline: a missing row means push is disabled for that
// device — no silent fallback, no fake "sent" notification.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_tokens (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT NOT NULL,
      token         TEXT NOT NULL,
      platform      TEXT NOT NULL CHECK (platform IN ('expo', 'web')),
      device_label  TEXT,
      vapid_keys_json TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      last_used_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at    INTEGER,
      UNIQUE (user_id, token)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_push_tokens_user  ON push_tokens(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_push_tokens_token ON push_tokens(token)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_push_tokens_used  ON push_tokens(last_used_at)`);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_push_tokens_used`);
  db.exec(`DROP INDEX IF EXISTS idx_push_tokens_token`);
  db.exec(`DROP INDEX IF EXISTS idx_push_tokens_user`);
  db.exec(`DROP TABLE IF EXISTS push_tokens`);
}
