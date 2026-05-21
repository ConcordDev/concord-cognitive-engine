// server/migrations/201_lattice_training_ops.js
//
// Lattice lens — MLOps fine-tuning console substrate.
//
// Four tables backing the experiment-tracking feature set surfaced in
// the Lattice lens (run history, eval curves, model rollback,
// scheduling, consent audit, A/B comparison):
//
//   brain_refresh_runs     — one row per daily/manual refresh run, with
//                            per-brain eval scores. Diffable over time;
//                            powers the run-history + eval-curve UI.
//   brain_refresh_schedule — per-brain cadence config (interval +
//                            enabled flag) so refresh isn't admin-only.
//   lattice_consent_log    — append-only audit of every consent toggle
//                            (who, what, when, old → new).
//   brain_ab_tests         — candidate-vs-active model A/B comparisons,
//                            with a traffic split and observed metrics.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_refresh_runs (
      id            TEXT PRIMARY KEY,
      brain_id      TEXT NOT NULL,
      trigger       TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'scheduled'
      status        TEXT NOT NULL DEFAULT 'completed',-- 'completed' | 'skipped' | 'failed'
      corpus_size   INTEGER NOT NULL DEFAULT 0,
      eval_score    REAL,                            -- post-build eval (nullable on skip/fail)
      prev_score    REAL,                            -- prior run's eval, for diffing
      swapped       INTEGER NOT NULL DEFAULT 0,      -- 1 = new model promoted to active
      model_name    TEXT,                            -- resulting ollama tag
      base_model    TEXT,
      detail_json   TEXT,                            -- full runner result JSON
      triggered_by  TEXT,                            -- user_id of trigger (nullable for scheduled)
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_brr_brain ON brain_refresh_runs(brain_id, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_brr_created ON brain_refresh_runs(created_at DESC)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_refresh_schedule (
      brain_id      TEXT PRIMARY KEY,
      enabled       INTEGER NOT NULL DEFAULT 0,
      cadence       TEXT NOT NULL DEFAULT 'daily',   -- 'daily' | 'weekly' | 'manual'
      interval_hours INTEGER NOT NULL DEFAULT 24,
      next_run_at   INTEGER,                          -- unixepoch of next scheduled run
      last_run_at   INTEGER,
      updated_by    TEXT,
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS lattice_consent_log (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      action        TEXT NOT NULL,                   -- 'toggle' | 'bulk'
      dtu_id        TEXT,                            -- nullable for bulk
      old_value     INTEGER,
      new_value     INTEGER NOT NULL,
      affected      INTEGER NOT NULL DEFAULT 1,      -- # of DTUs affected (bulk)
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lcl_user ON lattice_consent_log(user_id, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lcl_created ON lattice_consent_log(created_at DESC)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_ab_tests (
      id              TEXT PRIMARY KEY,
      brain_id        TEXT NOT NULL,
      candidate_model TEXT NOT NULL,                 -- model under test
      control_model   TEXT NOT NULL,                 -- current active model
      traffic_pct     INTEGER NOT NULL DEFAULT 10,   -- % of traffic to candidate
      status          TEXT NOT NULL DEFAULT 'running',-- 'running' | 'concluded'
      candidate_calls INTEGER NOT NULL DEFAULT 0,
      control_calls   INTEGER NOT NULL DEFAULT 0,
      candidate_score REAL,                          -- observed eval/metric
      control_score   REAL,
      winner          TEXT,                          -- 'candidate' | 'control' | null
      created_by      TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      concluded_at    INTEGER
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bab_brain ON brain_ab_tests(brain_id, status, created_at DESC)`);
}
