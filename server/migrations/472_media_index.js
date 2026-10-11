// Media index. /api/media/:id/stream used to resolve the row from an
// in-memory map, so every backend restart 404'd existing media URLs
// (chat images, uploads). The bytes already live in the artifact store;
// this table is the owner, privacy, and path needed to serve them again.
// Privacy values are stored as written. Access rules stay in canAccessMediaDTU.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_index (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      privacy TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT,
      disk_path TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      duration REAL,
      price_cc REAL,
      price_currency TEXT,
      preview_url TEXT,
      preview_start_ms INTEGER,
      preview_seconds REAL,
      thumbnail TEXT,
      artifact_json TEXT,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_index_owner ON media_index (owner_id);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS media_index;");
}

export const description = "Persist the media index so stream URLs survive a restart";
