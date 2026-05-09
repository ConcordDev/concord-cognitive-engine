// Migration 146 — DX Platform Phase A2: repair feedback + per-codebase
// evo tuning + shadow DTU surface.
// (Renumbered from 143 on rebase: main's 143 slot was claimed by the
// drop_dead_mig009 rename; 144 by mount_gear; 145 by macro_call_billing
// in PR #310. Next free slot is 146.)
//
// Wires the accept/reject signal from the editor plugin back into the
// detector + repair-cortex substrate so detector severity tunes per
// customer codebase. A user who consistently rejects a particular
// finding sees that detector's severity demote on subsequent sweeps.
//
// New tables:
//   codebases                      — per-customer registry (one row per
//                                    `(user_id, repo_root)` pair).
//   codebase_severity_weights      — per-codebase, per-(detector, rule)
//                                    multiplier on detector severity.
//                                    weight ∈ [0.1, 3.0].
//
// Schema extension on `repair_history` (idempotent — guarded by PRAGMA
// probe):
//   user_decision      TEXT CHECK(IN ('accepted','rejected','ignored',NULL))
//   decided_at         INTEGER
//   codebase_id        TEXT
//   finding_signature  TEXT — `${detectorId}:${ruleId}` (joined back to
//                              codebase_severity_weights when adjusting).
//
// CLAUDE.md invariant added by this phase:
//   Per-codebase severity weights clamp to [0.1, 3.0] and require ≥20
//   samples before adjusting. A detector can never be zeroed via
//   weighting. Weights reset on detector-version bump.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS codebases (
      id              TEXT    PRIMARY KEY,
      user_id         TEXT    NOT NULL,
      repo_root       TEXT    NOT NULL,
      shadow_dtu_id   TEXT,
      detector_version TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE (user_id, repo_root)
    );
    CREATE INDEX IF NOT EXISTS idx_codebases_user ON codebases(user_id);
    CREATE INDEX IF NOT EXISTS idx_codebases_last_seen ON codebases(last_seen_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS codebase_severity_weights (
      codebase_id      TEXT    NOT NULL,
      detector_id      TEXT    NOT NULL,
      rule_id          TEXT    NOT NULL,
      weight           REAL    NOT NULL DEFAULT 1.0 CHECK (weight >= 0.1 AND weight <= 3.0),
      accept_count     INTEGER NOT NULL DEFAULT 0,
      reject_count     INTEGER NOT NULL DEFAULT 0,
      ignore_count     INTEGER NOT NULL DEFAULT 0,
      detector_version TEXT,
      updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (codebase_id, detector_id, rule_id)
    );
    CREATE INDEX IF NOT EXISTS idx_codebase_weights_codebase
      ON codebase_severity_weights(codebase_id);
  `);

  // ALTER repair_history — idempotent re-run safe via PRAGMA probe.
  const cols = db.prepare("PRAGMA table_info(repair_history)").all().map(c => c.name);
  if (!cols.includes("user_decision")) {
    db.exec(`ALTER TABLE repair_history ADD COLUMN user_decision TEXT
             CHECK (user_decision IN ('accepted','rejected','ignored') OR user_decision IS NULL)`);
  }
  if (!cols.includes("decided_at")) {
    db.exec(`ALTER TABLE repair_history ADD COLUMN decided_at INTEGER`);
  }
  if (!cols.includes("codebase_id")) {
    db.exec(`ALTER TABLE repair_history ADD COLUMN codebase_id TEXT`);
  }
  if (!cols.includes("finding_signature")) {
    db.exec(`ALTER TABLE repair_history ADD COLUMN finding_signature TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_repair_history_codebase
           ON repair_history(codebase_id)
           WHERE codebase_id IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_repair_history_decision
           ON repair_history(user_decision, decided_at)
           WHERE user_decision IS NOT NULL`);
}

export function down(_db) { /* forward-only */ }
