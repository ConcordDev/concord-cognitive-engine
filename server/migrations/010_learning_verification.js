// migrations/010_learning_verification.js
// Learning Verification & Substrate Integrity schema additions.
// Tables for: DTU classification, citation tracking, novelty audit,
// helpfulness scoring, generation quotas, pruning history.
//
// NOTE (Phase 3.5.5 archival, May 2026):
//   The 7 tables in this migration (dtu_citations, dtu_helpfulness,
//   retrieval_metrics, novelty_daily, dedup_audits, pruning_history,
//   generation_quotas) are all superseded by the citation cascade
//   royalty system (server/economy/royalty-cascade.js + economy_ledger)
//   and the drift-monitor. Cartographer pass-1 confirmed zero SELECT
//   references. CREATE TABLE IF NOT EXISTS preserved for idempotency.
//   REPLACED_BY: economy/royalty-cascade.js + drift-monitor.js +
//                forgetting-engine.js + dtu-pipeline.js

export function up(db) {
  db.exec(`
    -- DTU citation tracking (append-only per DTU)
    CREATE TABLE IF NOT EXISTS dtu_citations (
      dtu_id          TEXT PRIMARY KEY,
      citation_count  INTEGER NOT NULL DEFAULT 0,
      first_cited     TEXT,
      last_cited      TEXT,
      positive_signals INTEGER NOT NULL DEFAULT 0,
      negative_signals INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_citations_count ON dtu_citations(citation_count);

    -- DTU helpfulness scores
    CREATE TABLE IF NOT EXISTS dtu_helpfulness (
      dtu_id          TEXT PRIMARY KEY,
      times_used      INTEGER NOT NULL DEFAULT 0,
      positive_signals INTEGER NOT NULL DEFAULT 0,
      negative_signals INTEGER NOT NULL DEFAULT 0,
      score           REAL NOT NULL DEFAULT 0.5
    );

    -- Retrieval hit rate hourly buckets
    CREATE TABLE IF NOT EXISTS retrieval_metrics (
      hour_key        TEXT PRIMARY KEY,
      ts_epoch        INTEGER NOT NULL,
      total_queries   INTEGER NOT NULL DEFAULT 0,
      semantic_cache  INTEGER NOT NULL DEFAULT 0,
      retrieval_sufficient INTEGER NOT NULL DEFAULT 0,
      llm_required    INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_retrieval_ts ON retrieval_metrics(ts_epoch);

    -- Novelty verification daily log
    CREATE TABLE IF NOT EXISTS novelty_daily (
      date_key        TEXT PRIMARY KEY,
      generated       INTEGER NOT NULL DEFAULT 0,
      novel           INTEGER NOT NULL DEFAULT 0,
      redundant       INTEGER NOT NULL DEFAULT 0,
      trivial         INTEGER NOT NULL DEFAULT 0,
      novelty_rate    REAL
    );

    -- Dedup audit history
    CREATE TABLE IF NOT EXISTS dedup_audits (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at          TEXT NOT NULL,
      checked         INTEGER NOT NULL DEFAULT 0,
      novel           INTEGER NOT NULL DEFAULT 0,
      redundant       INTEGER NOT NULL DEFAULT 0,
      trivial         INTEGER NOT NULL DEFAULT 0,
      novelty_rate    REAL,
      details_json    TEXT
    );

    -- Substrate pruning history
    CREATE TABLE IF NOT EXISTS pruning_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at          TEXT NOT NULL,
      scaffold_reclassified INTEGER NOT NULL DEFAULT 0,
      deprecated_reclassified INTEGER NOT NULL DEFAULT 0,
      repair_archived INTEGER NOT NULL DEFAULT 0,
      shadow_archived INTEGER NOT NULL DEFAULT 0,
      total_pruned    INTEGER NOT NULL DEFAULT 0
    );

    -- Generation quota tracking
    CREATE TABLE IF NOT EXISTS generation_quotas (
      id              TEXT PRIMARY KEY DEFAULT 'current',
      current_hour    TEXT,
      hour_count      INTEGER NOT NULL DEFAULT 0,
      current_day     TEXT,
      day_count       INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
