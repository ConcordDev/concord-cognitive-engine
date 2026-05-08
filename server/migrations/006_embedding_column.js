/**
 * Migration 006: Add embedding BLOB column to dtus table.
 * Stores Float64Array serialised as raw bytes for semantic search.
 *
 * NOTE (Phase 3.5.5 archival, May 2026):
 *   The `dtu_embeddings` ancillary table created here is no longer
 *   referenced by any SELECT in the codebase. The embedding column on
 *   `dtus` is the live path; `embeddings.js` and the semantic substrate
 *   read from there directly. The standalone table is preserved
 *   idempotently via CREATE TABLE IF NOT EXISTS so existing DBs aren't
 *   rebuilt; new installs allocate it but never write to it.
 *   REPLACED_BY: dtus.embedding column (live) + embeddings.js
 */

export function up(db) {
  // Add embedding column if dtus table exists
  const tableInfo = db.prepare("PRAGMA table_info(dtus)").all();
  const hasDtus = tableInfo.length > 0;

  if (!hasDtus) {
    // dtus table doesn't exist yet in SQLite (may use JSON backend)
    // Create a minimal embeddings table as fallback
    db.exec(`
      CREATE TABLE IF NOT EXISTS dtu_embeddings (
        dtu_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        model TEXT,
        dimension INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_dtu_embeddings_model ON dtu_embeddings(model);
    `);
    return;
  }

  // dtus table exists — add embedding column directly
  const hasEmbedding = tableInfo.some(col => col.name === "embedding");
  if (!hasEmbedding) {
    db.exec(`ALTER TABLE dtus ADD COLUMN embedding BLOB`);
  }

  // Also create the standalone table for JSON-backend fallback
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtu_embeddings (
      dtu_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      model TEXT,
      dimension INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_dtu_embeddings_model ON dtu_embeddings(model);
  `);
}

export function down(db) {
  // SQLite doesn't support DROP COLUMN easily; leave column in place
  db.exec(`DROP TABLE IF EXISTS dtu_embeddings`);
}
