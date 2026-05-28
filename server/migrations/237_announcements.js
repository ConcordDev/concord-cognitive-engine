// server/migrations/237_announcements.js
//
// Phase BB3 — operator announcements + roadmap feed.
//
// Concord today has no way for the dev to push "Phase BX is live" to
// all players. The News lens pulls GDELT (real-world news). This adds
// an in-game meta-channel.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
      id                   TEXT PRIMARY KEY,
      kind                 TEXT NOT NULL CHECK (kind IN
                             ('feature_drop','balance_change','event','news','roadmap')),
      title                TEXT NOT NULL,
      body_md              TEXT NOT NULL,
      published_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at           INTEGER,
      dtu_attachment_id    TEXT,
      author_user_id       TEXT,
      last_broadcast_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_announcements_published
      ON announcements(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_announcements_kind
      ON announcements(kind, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_announcements_broadcast
      ON announcements(last_broadcast_at, published_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_announcements_broadcast;
    DROP INDEX IF EXISTS idx_announcements_kind;
    DROP INDEX IF EXISTS idx_announcements_published;
    DROP TABLE IF EXISTS announcements;
  `);
}
