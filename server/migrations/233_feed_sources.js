// server/migrations/233_feed_sources.js
//
// Smoking-gun cleanup I2 — STATE.feeds was an in-memory Map at 6
// sites in server.js. Restart lost all feed configurations including
// per-user subscriptions + lastFetchedAt cursors. This migration
// adds the durable backing table.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_sources (
      id              TEXT PRIMARY KEY,
      url             TEXT NOT NULL,
      title           TEXT,
      kind            TEXT NOT NULL DEFAULT 'rss'
                      CHECK (kind IN ('rss','atom','json','sitemap','custom')),
      active          INTEGER NOT NULL DEFAULT 1,
      last_fetched_at INTEGER,
      last_error      TEXT,
      item_count      INTEGER NOT NULL DEFAULT 0,
      created_by      TEXT NOT NULL DEFAULT 'system',
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_feed_active ON feed_sources(active, last_fetched_at) WHERE active = 1;
    CREATE INDEX IF NOT EXISTS idx_feed_creator ON feed_sources(created_by, created_at DESC);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS feed_sources;`);
}
