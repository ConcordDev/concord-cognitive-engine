// server/migrations/431_pce_substrate.js
//
// PCE-1.0 substrate — AST cache, pattern IR, transforms, provenance, failures.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pce_ast_cache (
      repo_root       TEXT    NOT NULL,
      file_path       TEXT    NOT NULL,
      content_hash    TEXT    NOT NULL,
      ast_json        TEXT,
      symbols_json    TEXT,
      imports_json    TEXT,
      exports_json    TEXT,
      parse_ok        INTEGER NOT NULL DEFAULT 1,
      indexed_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (repo_root, file_path)
    );
    CREATE INDEX IF NOT EXISTS idx_pce_ast_repo ON pce_ast_cache(repo_root, indexed_at DESC);

    CREATE TABLE IF NOT EXISTS pce_patterns (
      pattern_id      TEXT    PRIMARY KEY,
      intent          TEXT    NOT NULL,
      category        TEXT,
      structural_shape_json TEXT NOT NULL,
      behavioral_contract_json TEXT,
      preconditions_json TEXT,
      invariants_json TEXT,
      verification_json TEXT,
      provenance_json TEXT,
      license         TEXT,
      confidence      REAL    NOT NULL DEFAULT 0.5,
      status          TEXT    NOT NULL DEFAULT 'registered'
                              CHECK (status IN ('registered','testing','active','deprecated','proposed')),
      version         TEXT    NOT NULL DEFAULT '1.0.0',
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_pce_patterns_intent ON pce_patterns(intent, confidence DESC);

    CREATE TABLE IF NOT EXISTS pce_pattern_stats (
      pattern_id      TEXT    PRIMARY KEY,
      applications    INTEGER NOT NULL DEFAULT 0,
      successes       INTEGER NOT NULL DEFAULT 0,
      failures        INTEGER NOT NULL DEFAULT 0,
      security_incidents INTEGER NOT NULL DEFAULT 0,
      regressions     INTEGER NOT NULL DEFAULT 0,
      median_transform_ms INTEGER,
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (pattern_id) REFERENCES pce_patterns(pattern_id)
    );

    CREATE TABLE IF NOT EXISTS pce_transform_log (
      id              TEXT    PRIMARY KEY,
      mission_id      TEXT,
      pattern_id      TEXT,
      primitive       TEXT    NOT NULL,
      file_path       TEXT,
      before_hash     TEXT,
      after_hash      TEXT,
      rollback_json   TEXT,
      risk            TEXT,
      status          TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','applied','verified','rolled_back','failed')),
      quality_score   REAL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_pce_transform_mission ON pce_transform_log(mission_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS pce_provenance (
      source_id       TEXT    PRIMARY KEY,
      repository      TEXT,
      commit_hash     TEXT,
      path            TEXT,
      license         TEXT,
      license_confidence REAL,
      allowed_usage   TEXT,
      retrieval_ts    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS pce_failure_signatures (
      signature_hash  TEXT    PRIMARY KEY,
      pattern_id      TEXT,
      context_json    TEXT,
      error_json      TEXT,
      repair_json     TEXT,
      occurrences     INTEGER NOT NULL DEFAULT 1,
      last_seen_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}
