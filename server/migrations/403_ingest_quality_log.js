/**
 * Migration 403 — Ingest Quality Log Table
 *
 * Tracks rejected feed DTUs for analysis and auditing.
 * Daily prune: keep last 50k rows, 30d retention.
 */

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ingest_quality_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      feed_id TEXT NOT NULL,
      feed_source TEXT,
      title TEXT,
      reject_reason TEXT NOT NULL,
      body_len INTEGER,
      source_url TEXT,
      details_json TEXT,
      created_by TEXT DEFAULT 'ingest-quality'
    );

    CREATE INDEX IF NOT EXISTS idx_ingest_quality_ts ON ingest_quality_log(ts);
    CREATE INDEX IF NOT EXISTS idx_ingest_quality_feed ON ingest_quality_log(feed_id);
    CREATE INDEX IF NOT EXISTS idx_ingest_quality_reason ON ingest_quality_log(reject_reason);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_ingest_quality_reason;
    DROP INDEX IF EXISTS idx_ingest_quality_feed;
    DROP INDEX IF EXISTS idx_ingest_quality_ts;
    DROP TABLE IF EXISTS ingest_quality_log;
  `);
}
