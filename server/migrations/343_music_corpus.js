// server/migrations/343_music_corpus.js
//
// Music Resonance (#43) — the second corpus on the Literary Resonance Lattice.
// "Music as a literary corpus": each track is a row in `music_tracks`; each
// section (verse/chorus/bridge/lyric/note) is a `music_chunks` row linked 1:1 to
// a real DTU, so it's a first-class lattice citizen (embeddings, CRETI,
// resonance bridges to the literary corpus). `music_chunks_fts` is the BM25
// keyword half of the same hybrid retrieval pipeline the literary lattice uses.
//
// LICENSE NOTE: this substrate is for USER-AUTHORED or public-domain / CC
// content only — the same legal floor as the literary corpus. The `license`
// column records provenance; non-PD/user content stays behind the consent path.
//
// Append-only; everything IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_tracks (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      artist       TEXT,
      era          TEXT,
      genre        TEXT,
      mood_json    TEXT NOT NULL DEFAULT '[]',
      license      TEXT NOT NULL DEFAULT 'user_authored',
      source_url   TEXT,
      track_dtu_id TEXT,
      chunk_count  INTEGER NOT NULL DEFAULT 0,
      ingested_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_music_tracks_artist ON music_tracks(artist)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_music_tracks_genre ON music_tracks(genre)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS music_chunks (
      id           TEXT PRIMARY KEY,
      track_id     TEXT NOT NULL,
      dtu_id       TEXT,
      ord          INTEGER NOT NULL DEFAULT 0,
      kind         TEXT NOT NULL DEFAULT 'lyric'
                     CHECK (kind IN ('lyric','verse','chorus','bridge','instrumental','note')),
      heading      TEXT,
      content      TEXT NOT NULL,
      token_count  INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_music_chunks_track ON music_chunks(track_id, ord)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_music_chunks_dtu ON music_chunks(dtu_id)`);

  // BM25 keyword index — the sparse half of hybrid retrieval (same shape as
  // literary_chunks_fts). Standalone FTS5; chunk_id UNINDEXED for the join back.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS music_chunks_fts
      USING fts5(chunk_id UNINDEXED, content, tokenize = 'porter unicode61');
  `);
}
