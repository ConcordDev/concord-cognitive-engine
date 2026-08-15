/**
 * Migration 406 — DTU Attachments + Binary Payload Storage
 *
 * Sprint 32 Binary Attachments: new tables for file attachments (deduped by SHA256)
 * + payload_bytes BLOB column on dtu_store for native binary payloads.
 * Supports any file format: PDF, PNG, MP3, MP4, ZIP, raw bytes, etc.
 */

export function up(db) {
  db.exec(`
    -- Binary attachments (deduped by SHA256)
    CREATE TABLE IF NOT EXISTS dtu_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dtu_id TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      filename TEXT,
      mime_type TEXT,
      size_bytes INTEGER NOT NULL,
      bytes BLOB NOT NULL,
      kind TEXT DEFAULT 'file',
      encoding TEXT,
      source TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (dtu_id, sha256)
    );

    CREATE INDEX IF NOT EXISTS idx_dtu_attachments_dtu ON dtu_attachments(dtu_id);
    CREATE INDEX IF NOT EXISTS idx_dtu_attachments_sha ON dtu_attachments(sha256);

    -- .dtu pack/unpack audit trail
    CREATE TABLE IF NOT EXISTS dtu_archives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dtu_id TEXT NOT NULL,
      archive_sha256 TEXT NOT NULL,
      archive_size INTEGER NOT NULL,
      attachment_count INTEGER DEFAULT 0,
      payload_kind TEXT,
      packed_at INTEGER NOT NULL,
      signature_valid INTEGER DEFAULT 1,
      UNIQUE (dtu_id)
    );

    CREATE INDEX IF NOT EXISTS idx_dtu_archives_dtu ON dtu_archives(dtu_id);

    -- Native binary payload column (separate from JSON data column)
    ALTER TABLE dtu_store ADD COLUMN payload_bytes BLOB;
    ALTER TABLE dtu_store ADD COLUMN payload_kind TEXT DEFAULT 'text';
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_dtu_archives_dtu;
    DROP TABLE IF EXISTS dtu_archives;
    DROP INDEX IF EXISTS idx_dtu_attachments_sha;
    DROP INDEX IF EXISTS idx_dtu_attachments_dtu;
    DROP TABLE IF EXISTS dtu_attachments;
    ALTER TABLE dtu_store DROP COLUMN payload_kind;
    ALTER TABLE dtu_store DROP COLUMN payload_bytes;
  `);
}
