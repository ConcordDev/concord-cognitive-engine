// server/migrations/222_browser_agent_moats.js
//
// Browser-Agent lens Sprint C — concord-native moats.
//
//   browser_task_schedules  — Devin-style recurring runs (cron-ish:
//                              daily at HH:MM, every N hours, weekly
//                              on day, or RFC-5545 RRULE).
//   browser_task_chains     — when task X completes, run Y with the
//                              templated args (template_json runs
//                              through {{lastResult}}, {{lastUrl}},
//                              etc).
//   browser_agent_templates — reusable goal templates publishable as
//                              agent_spec DTUs (concord moat).
//   browser_task_mints      — when a finished run is minted as a
//                              browser_run DTU + royalty cascade
//                              receipt.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_task_schedules (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      template_id     TEXT,                              -- optional: instantiate from this template each run
      title           TEXT NOT NULL,
      goal            TEXT NOT NULL,
      starting_url    TEXT,
      approval_mode   TEXT NOT NULL DEFAULT 'destructive_only',
      max_steps       INTEGER NOT NULL DEFAULT 30,
      max_cost_cents  INTEGER,
      cadence_kind    TEXT NOT NULL DEFAULT 'every_n_hours'
                      CHECK (cadence_kind IN ('every_n_hours','daily','weekly','rrule','once_at')),
      cadence_param   TEXT NOT NULL,                     -- '6' (hours) | '09:00' | 'MO' | 'FREQ=DAILY;INTERVAL=2' | unixepoch
      next_run_at     INTEGER NOT NULL,
      last_run_at     INTEGER,
      last_task_id    TEXT,
      enabled         INTEGER NOT NULL DEFAULT 1,
      run_count       INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_bts_user      ON browser_task_schedules(user_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_bts_due       ON browser_task_schedules(enabled, next_run_at) WHERE enabled = 1;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_task_chains (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      trigger_task_id TEXT,                              -- specific source task (null = any task matching pattern)
      trigger_template_id TEXT,
      trigger_on      TEXT NOT NULL DEFAULT 'success'
                      CHECK (trigger_on IN ('success','failure','any')),
      next_template_id TEXT,                             -- template to instantiate as the chained task
      next_goal_template TEXT,                           -- raw goal text with {{lastResult}} / {{lastUrl}} placeholders
      input_map_json  TEXT,                              -- JSON map of how to pass data from source to target
      enabled         INTEGER NOT NULL DEFAULT 1,
      fire_count      INTEGER NOT NULL DEFAULT 0,
      last_fired_at   INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_btc_user    ON browser_task_chains(user_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_btc_trigger ON browser_task_chains(trigger_task_id) WHERE trigger_task_id IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_agent_templates (
      id              TEXT PRIMARY KEY,
      owner_id        TEXT NOT NULL,
      name            TEXT NOT NULL,
      description     TEXT,
      category        TEXT NOT NULL DEFAULT 'general'
                      CHECK (category IN ('general','research','monitoring','data_capture','form_fill','content','social','dev_ops','support','custom')),
      icon            TEXT,
      goal_template   TEXT NOT NULL,                      -- Mustache-ish; vars: {{url}} {{query}} {{date}} {{user_name}}
      default_starting_url TEXT,
      default_approval_mode TEXT NOT NULL DEFAULT 'destructive_only',
      default_max_steps INTEGER NOT NULL DEFAULT 30,
      default_max_cost_cents INTEGER NOT NULL DEFAULT 100,
      tool_allowlist_json TEXT,
      visibility      TEXT NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private','workspace','public')),
      dtu_id          TEXT,                              -- when published as agent_spec DTU
      usage_count     INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_tmpl_owner ON browser_agent_templates(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tmpl_vis   ON browser_agent_templates(visibility, usage_count DESC);
    CREATE INDEX IF NOT EXISTS idx_tmpl_cat   ON browser_agent_templates(category, usage_count DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_task_mints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id         TEXT NOT NULL UNIQUE,
      dtu_id          TEXT NOT NULL UNIQUE,
      creator_id      TEXT NOT NULL,
      royalty_rate    REAL NOT NULL DEFAULT 0.21,
      visibility      TEXT NOT NULL DEFAULT 'workspace'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      allow_citation  INTEGER NOT NULL DEFAULT 1,
      citation_count  INTEGER NOT NULL DEFAULT 0,
      minted_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (task_id) REFERENCES browser_tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_btm_creator ON browser_task_mints(creator_id, minted_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS browser_task_mints;
    DROP TABLE IF EXISTS browser_agent_templates;
    DROP TABLE IF EXISTS browser_task_chains;
    DROP TABLE IF EXISTS browser_task_schedules;
  `);
}
