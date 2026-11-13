// server/migrations/501_cockpit_runs.js
//
// GB-1500 cockpit: durable runs. A Run is a goal plus an ordered plan of Steps;
// cockpit_effects is the write-ahead claim that stops a restarted run from
// repeating a write. Status columns have no CHECK constraint on purpose: the
// allowed values are enforced in lib/cockpit/run-store.js so a later state
// needs no table rebuild.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cockpit_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      surface TEXT NOT NULL,
      chat_session_id TEXT,
      lens_context TEXT,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      status_reason TEXT,
      plan_version INTEGER NOT NULL DEFAULT 1,
      cursor INTEGER NOT NULL DEFAULT 1,
      budget_json TEXT NOT NULL DEFAULT '{}',
      usage_json TEXT NOT NULL DEFAULT '{}',
      model_profile TEXT NOT NULL DEFAULT 'local-2b',
      resume_at INTEGER,
      lease_owner TEXT,
      lease_until INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_cockpit_runs_user ON cockpit_runs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cockpit_runs_due ON cockpit_runs(status, resume_at);

    CREATE TABLE IF NOT EXISTS cockpit_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      plan_version INTEGER NOT NULL DEFAULT 1,
      goal TEXT NOT NULL,
      tool TEXT,
      args_json TEXT,
      expects_json TEXT NOT NULL DEFAULT '[]',
      depends_on_json TEXT NOT NULL DEFAULT '[]',
      required INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      result_ref TEXT,
      result_json TEXT,
      result_summary_json TEXT,
      receipt_json TEXT,
      idempotency_key TEXT,
      error_class TEXT,
      error_text TEXT,
      repairs_json TEXT NOT NULL DEFAULT '[]',
      fallback_tool TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      UNIQUE (run_id, plan_version, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_cockpit_steps_run ON cockpit_steps(run_id, plan_version, seq);

    CREATE TABLE IF NOT EXISTS cockpit_effects (
      idempotency_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      args_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'claimed',
      result_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS cockpit_effects;
    DROP TABLE IF EXISTS cockpit_steps;
    DROP TABLE IF EXISTS cockpit_runs;
  `);
}
