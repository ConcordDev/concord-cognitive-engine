// server/migrations/207_code_embeddings.js
//
// Code Sprint D — semantic embeddings for code-engine patterns
// (and future kinds). Real-vector storage in SQLite. For corpora
// >100k vectors, swap to qdrant via init-modalities probe — the
// table is the source of truth either way.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS code_embeddings (
      id           TEXT PRIMARY KEY,
      source_type  TEXT NOT NULL,         -- 'code_pattern' | 'code_spec' | 'code_skill' | ...
      source_id    TEXT NOT NULL,
      model        TEXT NOT NULL,         -- 'nomic-embed-text' | 'mxbai-embed-large' | ...
      dim          INTEGER NOT NULL,
      vector       BLOB NOT NULL,         -- Float32 little-endian
      text_preview TEXT,                  -- first ~200 chars of the embedded text
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(source_type, source_id, model)
    );
    CREATE INDEX IF NOT EXISTS idx_code_emb_source ON code_embeddings(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_code_emb_model ON code_embeddings(model);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS code_embeddings`);
}
