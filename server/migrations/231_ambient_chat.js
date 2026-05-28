// server/migrations/231_ambient_chat.js
//
// Phase AG — co-presence: district ambient chat.
//
// Bakharev's "society of spectacle" — players should see the strangers
// in their district, not just their friends. Drives engagement without
// forcing grouping. Messages are ephemeral (1h default TTL) so the
// district feed self-cleans.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ambient_chat_messages (
      id           TEXT PRIMARY KEY,
      world_id     TEXT NOT NULL,
      district_id  TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      body         TEXT NOT NULL,
      posted_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ambient_world_district
      ON ambient_chat_messages(world_id, district_id, posted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ambient_expiry
      ON ambient_chat_messages(expires_at);
    CREATE INDEX IF NOT EXISTS idx_ambient_user_rate
      ON ambient_chat_messages(user_id, posted_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_ambient_user_rate;
    DROP INDEX IF EXISTS idx_ambient_expiry;
    DROP INDEX IF EXISTS idx_ambient_world_district;
    DROP TABLE IF EXISTS ambient_chat_messages;
  `);
}
