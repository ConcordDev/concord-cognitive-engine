// server/migrations/216_tasks_moats.js
//
// Tasks Sprint C — concord-native moats.
//
// task_project_agents — project-bound agents (Notion Custom Agents
// + Linear Agent parity) publishable as agent_spec DTUs so they
// flow into the marketplace via the existing royalty pipeline.
//
// task_project_mints — when a project is minted as a citable DTU
// (project_spec kind). Royalty rate captured at mint time so the
// cascade follows the agreed cut even if invariants evolve.
//
// task_project_templates — reusable project scaffolds with full
// workflow + custom fields + initial tasks. Mirrors doc_templates
// shape; seeded with 4 built-in defaults on first list.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_project_agents (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL,
      owner_id        TEXT NOT NULL,
      name            TEXT NOT NULL,
      description     TEXT,
      system_prompt   TEXT NOT NULL,
      capabilities_json TEXT,        -- ["read_tasks","read_sprint","write_task","triage","auto_assign"]
      slot            TEXT NOT NULL DEFAULT 'utility'
                      CHECK (slot IN ('conscious','subconscious','utility','repair','multimodal')),
      dtu_id          TEXT,           -- set on publish
      active          INTEGER NOT NULL DEFAULT 1,
      invocation_count INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tpa_project ON task_project_agents(project_id, active);
    CREATE INDEX IF NOT EXISTS idx_tpa_dtu     ON task_project_agents(dtu_id) WHERE dtu_id IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_project_mints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id      TEXT NOT NULL UNIQUE,
      dtu_id          TEXT NOT NULL UNIQUE,
      creator_id      TEXT NOT NULL,
      royalty_rate    REAL NOT NULL DEFAULT 0.21,
      visibility      TEXT NOT NULL DEFAULT 'workspace'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      allow_citation  INTEGER NOT NULL DEFAULT 1,
      citation_count  INTEGER NOT NULL DEFAULT 0,
      minted_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tpm_creator ON task_project_mints(creator_id, minted_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_project_templates (
      id              TEXT PRIMARY KEY,
      owner_id        TEXT NOT NULL,
      name            TEXT NOT NULL,
      description     TEXT,
      category        TEXT NOT NULL DEFAULT 'general'
                      CHECK (category IN ('general','software','marketing','onboarding','sprint','okr','launch','support','custom')),
      icon            TEXT,
      template_json   TEXT NOT NULL,    -- {workflow:{statuses,transitions}, customFields:[], seedTasks:[]}
      visibility      TEXT NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private','workspace','public')),
      usage_count     INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_tpt_owner ON task_project_templates(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tpt_vis   ON task_project_templates(visibility, usage_count DESC);
    CREATE INDEX IF NOT EXISTS idx_tpt_cat   ON task_project_templates(category, usage_count DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS task_project_templates;
    DROP TABLE IF EXISTS task_project_mints;
    DROP TABLE IF EXISTS task_project_agents;
  `);
}
