// Migration 440 — DTU cognitive schema enrichment + repo↔DTU links

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtu_cognitive_meta (
      dtu_id TEXT PRIMARY KEY,
      causal_parents_json TEXT DEFAULT '[]',
      causal_children_json TEXT DEFAULT '[]',
      outcomes_json TEXT DEFAULT '[]',
      applicability_json TEXT DEFAULT '{}',
      invalidation_json TEXT DEFAULT NULL,
      usage_history_json TEXT DEFAULT '[]',
      confidence REAL DEFAULT 1.0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_dtu_cognitive_confidence
      ON dtu_cognitive_meta(confidence DESC);

    CREATE TABLE IF NOT EXISTS dtu_repo_links (
      dtu_id TEXT NOT NULL,
      repo_ref TEXT NOT NULL,
      link_kind TEXT NOT NULL DEFAULT 'references',
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (dtu_id, repo_ref, link_kind)
    );

    CREATE INDEX IF NOT EXISTS idx_dtu_repo_ref ON dtu_repo_links(repo_ref);
    CREATE INDEX IF NOT EXISTS idx_dtu_repo_dtu ON dtu_repo_links(dtu_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS dtu_repo_links;
    DROP TABLE IF EXISTS dtu_cognitive_meta;
  `);
}
