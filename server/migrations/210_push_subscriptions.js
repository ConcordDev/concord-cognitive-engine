// server/migrations/210_push_subscriptions.js
//
// Message lens Sprint B #18 — push notifications substrate.
// Stores Web Push subscriptions for users; the push hook fires when
// mentions / DMs / unread thread events haven't been ack'd within
// a short window.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      endpoint     TEXT NOT NULL,
      keys_json    TEXT NOT NULL,                       -- { auth, p256dh }
      user_agent   TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, endpoint)
    );
    CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS push_subscriptions`);
}
