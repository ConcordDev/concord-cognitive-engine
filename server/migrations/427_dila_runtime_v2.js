// server/migrations/427_dila_runtime_v2.js
//
// Dila runtime v2 — repo graph edges, soak runs, improvement promotion audit.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_repo_edges (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_root       TEXT    NOT NULL,
      from_ref        TEXT    NOT NULL,
      to_ref          TEXT    NOT NULL,
      edge_kind       TEXT    NOT NULL
                              CHECK (edge_kind IN ('import','test','route','migration','api_macro')),
      meta_json       TEXT,
      indexed_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(repo_root, from_ref, to_ref, edge_kind)
    );
    CREATE INDEX IF NOT EXISTS idx_repo_edges_kind
      ON runtime_repo_edges(repo_root, edge_kind);
    CREATE INDEX IF NOT EXISTS idx_repo_edges_from
      ON runtime_repo_edges(repo_root, from_ref);

    CREATE TABLE IF NOT EXISTS runtime_repo_meta (
      repo_root           TEXT    PRIMARY KEY,
      last_full_index_at  INTEGER,
      files_count         INTEGER NOT NULL DEFAULT 0,
      edges_count         INTEGER NOT NULL DEFAULT 0,
      graphs_json         TEXT
    );

    CREATE TABLE IF NOT EXISTS runtime_soak_runs (
      id              TEXT    PRIMARY KEY,
      mission_id      TEXT,
      virtual_days    INTEGER NOT NULL,
      ticks_per_day   INTEGER NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running','completed','failed')),
      coherence_json  TEXT,
      summary_json    TEXT,
      started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at    INTEGER
    );
  `);
}
