// server/migrations/220_browser_agent.js
//
// Browser Agent lens Sprint A — safety + observability substrate.
//
// Layers ON TOP of the existing agent_marathon_sessions /
// browser-engine.js / chat-agent.js infrastructure. Adds the bits
// rivals shipped after the OpenAI-Operator-shutdown lessons:
// approval mode, per-task cost budgets, per-tool permission scopes,
// concurrent caps, and a forensic per-action audit log.
//
// Four tables:
//   browser_tasks         — the per-task orchestration spec
//   browser_task_actions  — append-only ledger of every click/type/
//                           navigate/screenshot/extract action
//   browser_task_budgets  — per-user defaults + per-task overrides
//   browser_task_approvals — pending pause-points awaiting user
//                           confirmation on destructive actions

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_tasks (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL,
      marathon_session_id TEXT,                            -- nullable; links to agent_marathon_sessions when long-running
      title               TEXT NOT NULL,
      goal                TEXT NOT NULL,                    -- natural-language task spec
      starting_url        TEXT,
      status              TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','planning','awaiting_approval','running','paused','completed','failed','cancelled','budget_exceeded')),
      approval_mode       TEXT NOT NULL DEFAULT 'destructive_only'
                          CHECK (approval_mode IN ('off','destructive_only','every_step')),
      max_steps           INTEGER NOT NULL DEFAULT 30,      -- hard cap per task
      max_cost_cents      INTEGER,                          -- nullable; null = inherit user default
      tool_allowlist_json TEXT,                             -- ["browser_act","browse_url","web_search"]; null = default
      context_isolated    INTEGER NOT NULL DEFAULT 1,       -- 1 = fresh browser context per task
      user_agent          TEXT,
      geo_region          TEXT,                             -- 'us-east','eu-west'…
      proxy_url           TEXT,                             -- optional outbound proxy
      result_summary      TEXT,
      total_steps         INTEGER NOT NULL DEFAULT 0,
      total_cost_cents    INTEGER NOT NULL DEFAULT 0,
      total_tokens        INTEGER NOT NULL DEFAULT 0,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at          INTEGER,
      completed_at        INTEGER,
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_browser_tasks_user   ON browser_tasks(user_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_browser_tasks_status ON browser_tasks(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_browser_tasks_marathon ON browser_tasks(marathon_session_id) WHERE marathon_session_id IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_task_actions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id      TEXT NOT NULL,
      step_index   INTEGER NOT NULL,
      kind         TEXT NOT NULL,                            -- 'navigate','click','type','select','file','screenshot','extract','scroll','wait','assert','llm_step','approval','error'
      tool         TEXT,                                     -- 'browser_act','browse_url','web_search',…
      url          TEXT,
      selector     TEXT,
      value        TEXT,
      thought      TEXT,                                     -- LLM reasoning for this step
      result_json  TEXT,                                     -- {ok, html_snippet, dom_text_len, …}
      destructive  INTEGER NOT NULL DEFAULT 0,               -- flagged for approval-mode gating
      success      INTEGER NOT NULL DEFAULT 1,
      latency_ms   INTEGER,
      cost_cents   INTEGER NOT NULL DEFAULT 0,
      tokens       INTEGER NOT NULL DEFAULT 0,
      screenshot_url TEXT,                                   -- /api/browser-asset/{taskId}/{stepIndex}.png
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (task_id) REFERENCES browser_tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_browser_actions_task ON browser_task_actions(task_id, step_index);
    CREATE INDEX IF NOT EXISTS idx_browser_actions_kind ON browser_task_actions(task_id, kind);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_task_budgets (
      user_id              TEXT PRIMARY KEY,
      daily_cents_cap      INTEGER NOT NULL DEFAULT 500,     -- $5/day default
      monthly_cents_cap    INTEGER NOT NULL DEFAULT 5000,    -- $50/mo default
      per_task_default_cents INTEGER NOT NULL DEFAULT 100,   -- $1/task default cap
      concurrent_task_max  INTEGER NOT NULL DEFAULT 3,
      approval_mode_default TEXT NOT NULL DEFAULT 'destructive_only'
                           CHECK (approval_mode_default IN ('off','destructive_only','every_step')),
      tool_default_json    TEXT,                              -- baseline allowlist
      updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_task_approvals (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id      TEXT NOT NULL,
      step_index   INTEGER NOT NULL,
      reason       TEXT NOT NULL,                            -- 'destructive_action','budget_overrun','captcha_detected','authentication_needed','external_purchase'
      proposed_action_json TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','expired')),
      decided_by   TEXT,
      decided_at   INTEGER,
      decision_note TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at   INTEGER,
      FOREIGN KEY (task_id) REFERENCES browser_tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_task   ON browser_task_approvals(task_id, status);
    CREATE INDEX IF NOT EXISTS idx_approvals_pending ON browser_task_approvals(status, expires_at) WHERE status = 'pending';
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS browser_task_approvals;
    DROP TABLE IF EXISTS browser_task_budgets;
    DROP TABLE IF EXISTS browser_task_actions;
    DROP TABLE IF EXISTS browser_tasks;
  `);
}
