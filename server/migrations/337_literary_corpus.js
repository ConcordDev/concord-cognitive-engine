// server/migrations/337_literary_corpus.js
//
// Literary Resonance Lattice (LRL) / Literary Lattice Shell (LLS) — Phase 1.
//
// Turns the public-domain literary corpus (Project Gutenberg / Standard Ebooks)
// into a sovereign, local-first semantic substrate. Each work is a row in
// `literary_sources`; each chunk is a row in `literary_chunks` linked 1:1 to a
// real DTU (created via economy/dtu-pipeline#createDTU) so it is a first-class
// citizen of the lattice (embeddings in dtus.embedding BLOB, CRETI scoring,
// consolidation). `literary_chunks_fts` is the BM25 keyword half of the hybrid
// retrieval pipeline (the dense half is the existing embedding cosine /
// optional sqlite-vec index).
//
// Append-only migration; everything IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS literary_sources (
      id            TEXT PRIMARY KEY,
      gutenberg_id  TEXT,
      title         TEXT NOT NULL,
      author        TEXT,
      era           TEXT,
      language      TEXT NOT NULL DEFAULT 'en',
      genre         TEXT,
      themes_json   TEXT NOT NULL DEFAULT '[]',
      license       TEXT NOT NULL DEFAULT 'public_domain',
      pd_verified   INTEGER NOT NULL DEFAULT 0,
      url           TEXT,
      work_dtu_id   TEXT,
      chunk_count   INTEGER NOT NULL DEFAULT 0,
      ingested_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lit_sources_gutenberg ON literary_sources(gutenberg_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lit_sources_author ON literary_sources(author)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS literary_chunks (
      id           TEXT PRIMARY KEY,
      source_id    TEXT NOT NULL,
      dtu_id       TEXT,
      chapter_num  INTEGER,
      section_num  INTEGER,
      ord          INTEGER NOT NULL DEFAULT 0,
      kind         TEXT NOT NULL DEFAULT 'prose'
                     CHECK (kind IN ('prose','verse','drama','heading','front_matter')),
      heading      TEXT,
      content      TEXT NOT NULL,
      token_count  INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (source_id) REFERENCES literary_sources(id) ON DELETE CASCADE
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lit_chunks_source ON literary_chunks(source_id, ord)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lit_chunks_dtu ON literary_chunks(dtu_id)`);

  // BM25 keyword index — the sparse half of hybrid retrieval. Standalone (not
  // external-content) FTS5 so it works regardless of the TEXT primary key on
  // literary_chunks; chunk_id is stored UNINDEXED for the join back.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS literary_chunks_fts
      USING fts5(chunk_id UNINDEXED, content, tokenize = 'porter unicode61');
  `);
}
