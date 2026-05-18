// server/migrations/221_browser_agent_ai.js
//
// Browser-Agent lens Sprint B — AI planning + cost ledger.
//
// browser_task_plans  — LLM-produced step plan attached to a task so
//                       the user can preview-and-approve before
//                       execution. Each plan is versioned (revision)
//                       so we can show diffs when re-planning.
//
// browser_task_ai_runs — append-only ledger of LLM invocations across
//                       compose_plan / voice_task / run_step /
//                       summarize_run / reschedule.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_task_plans (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id       TEXT NOT NULL,
      revision      INTEGER NOT NULL DEFAULT 1,
      plan_json     TEXT NOT NULL,                    -- [{step, action, expected, ifFails}]
      author        TEXT NOT NULL DEFAULT 'llm'
                    CHECK (author IN ('llm','user','hybrid')),
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','superseded','consumed')),
      llm_thought   TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      approved_at   INTEGER,
      approved_by   TEXT,
      FOREIGN KEY (task_id) REFERENCES browser_tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_plans_task ON browser_task_plans(task_id, revision DESC);
    CREATE INDEX IF NOT EXISTS idx_plans_pending ON browser_task_plans(status, created_at DESC) WHERE status = 'pending';
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_task_ai_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id      TEXT,
      user_id      TEXT NOT NULL,
      kind         TEXT NOT NULL,                     -- compose_plan|voice_task|run_step|summarize|reschedule|chat
      prompt       TEXT,
      input_text   TEXT,
      output_text  TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT 'llm'
                   CHECK (source IN ('llm','fallback','deterministic')),
      tokens_in    INTEGER NOT NULL DEFAULT 0,
      tokens_out   INTEGER NOT NULL DEFAULT 0,
      latency_ms   INTEGER,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_bag_ai_user ON browser_task_ai_runs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bag_ai_task ON browser_task_ai_runs(task_id, created_at DESC) WHERE task_id IS NOT NULL;
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS browser_task_ai_runs;
    DROP TABLE IF EXISTS browser_task_plans;
  `);
}
