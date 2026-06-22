// server/migrations/338_literary_resonance.js
//
// LRL Phase 2 — cross-domain resonance edges. Each row links a literary chunk's
// DTU to a semantically-near DTU in ANOTHER lens/domain (code, engineering,
// Concordia, ...), forming the bridges that let humanity's narrative/ethical/
// metaphorical examples ground reasoning across the whole lattice. Edges are
// computed from embedding cosine by the literary-resonance-cycle heartbeat and
// read back via the literary.resonance macro.
//
// Append-only; IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS literary_resonance_edges (
      id              TEXT PRIMARY KEY,
      literary_dtu_id TEXT NOT NULL,
      target_dtu_id   TEXT NOT NULL,
      target_domain   TEXT,
      kind            TEXT NOT NULL DEFAULT 'cross_domain',
      score           REAL NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE (literary_dtu_id, target_dtu_id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lit_res_src ON literary_resonance_edges(literary_dtu_id, score DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lit_res_tgt ON literary_resonance_edges(target_dtu_id)`);
}
