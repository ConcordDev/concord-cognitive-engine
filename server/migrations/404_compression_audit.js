/**
 * Migration 404 — Compression Audit Table
 *
 * Tracks all MEGA/HYPER tier compression attempts (passes and failures).
 * Daily prune: keep last 50k rows, 30d retention.
 */

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS compression_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      source_dtu_id TEXT NOT NULL,
      target_mega_id TEXT NOT NULL,
      score REAL,
      pass INTEGER DEFAULT 0,
      reasons_json TEXT,
      child_count INTEGER,
      created_by TEXT DEFAULT 'compression-quality'
    );

    CREATE INDEX IF NOT EXISTS idx_compression_audit_ts ON compression_audit(ts);
    CREATE INDEX IF NOT EXISTS idx_compression_audit_target ON compression_audit(target_mega_id);
    CREATE INDEX IF NOT EXISTS idx_compression_audit_pass ON compression_audit(pass);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_compression_audit_pass;
    DROP INDEX IF EXISTS idx_compression_audit_target;
    DROP INDEX IF EXISTS idx_compression_audit_ts;
    DROP TABLE IF EXISTS compression_audit;
  `);
}
