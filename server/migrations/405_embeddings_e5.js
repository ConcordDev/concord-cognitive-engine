/**
 * Migration 405 — Embeddings E5/MTEB Table
 *
 * Sprint 32 E5: new embeddings table for mxbai-embed-large (1024-dim, MTEB SOTA).
 * Originally planned intfloat/e5-large-v2 but unavailable in ollama library;
 * mxbai is drop-in compatible (same prefixes + dimension).
 * Separate from legacy `embeddings` (768-dim) for backwards compatibility.
 * Batch-populated by boot-time backfill worker (reads dtu_store.data JSON).
 */

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings_e5 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dtu_id TEXT NOT NULL,
      vector BLOB NOT NULL,
      dim INTEGER DEFAULT 1024,
      model TEXT DEFAULT 'mxbai-embed-large',
      source TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (dtu_id, source, model)
    );

    CREATE INDEX IF NOT EXISTS idx_embeddings_e5_dtu ON embeddings_e5(dtu_id);
    CREATE INDEX IF NOT EXISTS idx_embeddings_e5_model ON embeddings_e5(model);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_embeddings_e5_model;
    DROP INDEX IF EXISTS idx_embeddings_e5_dtu;
    DROP TABLE IF EXISTS embeddings_e5;
  `);
}
