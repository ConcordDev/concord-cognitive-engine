// server/migrations/215_tasks_ai.js
//
// Tasks Sprint B — AI surface substrate.
//
// task_ai_runs — append-only ledger of every AI invocation against
// a task or project. Used by auto-prioritize provenance + standup
// generator audit + triage-intelligence learning loop.
//
// task_triage_rules — per-project triage rules (Linear Triage
// Intelligence parity). Learned-by-pattern + author-edited. When a
// task is created, the triage cycle scans its title/body for any
// matching rule and applies the action (set assignee / set priority
// / add label / set status). Confidence captured so rules can be
// auto-pruned over time.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_ai_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id      TEXT,                              -- nullable for project-level runs (standup / break-down / prioritize)
      project_id   TEXT,
      user_id      TEXT NOT NULL,
      kind         TEXT NOT NULL,                     -- compose_plan|breakdown|prioritize|standup|triage|voice|tone_polish|search
      prompt       TEXT,
      input_text   TEXT,
      output_text  TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT 'llm'
                   CHECK (source IN ('llm','fallback','deterministic')),
      latency_ms   INTEGER,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_task_ai_runs_user ON task_ai_runs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_ai_runs_task ON task_ai_runs(task_id, created_at DESC) WHERE task_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_task_ai_runs_proj ON task_ai_runs(project_id, created_at DESC) WHERE project_id IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_triage_rules (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL,
      name          TEXT NOT NULL,
      pattern       TEXT NOT NULL,                     -- substring/regex matched against title + description
      pattern_kind  TEXT NOT NULL DEFAULT 'substring'
                    CHECK (pattern_kind IN ('substring','regex','keyword')),
      action_json   TEXT NOT NULL,                     -- {setPriority, setAssignee, addLabels, setStatus, setType}
      author_id     TEXT NOT NULL,
      origin        TEXT NOT NULL DEFAULT 'human'
                    CHECK (origin IN ('human','learned')),
      confidence    REAL NOT NULL DEFAULT 1.0,
      hit_count     INTEGER NOT NULL DEFAULT 0,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_triage_rules_proj ON task_triage_rules(project_id, active);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS task_triage_rules;
    DROP TABLE IF EXISTS task_ai_runs;
  `);
}
