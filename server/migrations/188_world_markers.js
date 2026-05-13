// server/migrations/188_world_markers.js
//
// Phase H2 — player-placed + system-placed world markers (POI). Surfaces
// the orphan `WorldMarkers.tsx` overlay.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_markers (
      id            TEXT PRIMARY KEY,
      world_id      TEXT NOT NULL,
      kind          TEXT NOT NULL CHECK (kind IN ('poi', 'quest', 'caution', 'celebration', 'system')),
      label         TEXT,
      x             REAL NOT NULL,
      z             REAL NOT NULL,
      placed_by     TEXT,
      placed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_world_markers_world ON world_markers(world_id, expires_at);
  `);
}

export function down(_db) { /* forward-only */ }
