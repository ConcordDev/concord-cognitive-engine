// server/migrations/214_tasks.js
//
// Tasks lens Sprint A — Jira-customisable substrate.
//
// 14 tables covering projects (workspace tier above tasks), tasks
// (with PROJ-key + parent_id hierarchy), task_workflows (per-project
// customisable status pipelines), task_custom_fields, task_sprints,
// task_participants (multi-assignee + watchers + reviewers),
// task_dependencies (blocks / relates / dupe), task_comments,
// task_attachments, task_links (cross-app: code/PR/doc/dtu/lens),
// task_history (audit), task_labels, task_time_entries, and
// task_saved_views (per-user view persistence).
//
// Mirrors the docs migration shape: 5-tier roles via project_members,
// soft delete via deleted_at, sortable position float, JSON columns
// for arrays / config so the schema stays stable as workflows evolve.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id                TEXT PRIMARY KEY,
      owner_id          TEXT NOT NULL,
      key               TEXT NOT NULL UNIQUE,         -- 'WEB', 'MOBILE' — uppercase prefix
      name              TEXT NOT NULL,
      description       TEXT,
      icon              TEXT,
      color             TEXT DEFAULT '#22d3ee',
      visibility        TEXT NOT NULL DEFAULT 'private'
                        CHECK (visibility IN ('private','team','workspace','public')),
      next_task_number  INTEGER NOT NULL DEFAULT 1,
      default_workflow_id TEXT,
      settings_json     TEXT,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      deleted_at        INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_projects_vis   ON projects(visibility, updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('owner','admin','member','viewer')),
      invited_by  TEXT,
      invited_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (project_id, user_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_workflows (
      id                TEXT PRIMARY KEY,
      project_id        TEXT NOT NULL,
      name              TEXT NOT NULL,
      statuses_json     TEXT NOT NULL,   -- [{id,name,category:backlog|todo|in_progress|done|cancelled,color}]
      transitions_json  TEXT,            -- [{from,to,name}] (null = any-to-any)
      default_status_id TEXT NOT NULL,
      is_default        INTEGER NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_workflows_proj ON task_workflows(project_id, is_default DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_custom_fields (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL,
      key           TEXT NOT NULL,
      label         TEXT NOT NULL,
      type          TEXT NOT NULL CHECK (type IN ('text','number','select','multi_select','date','checkbox','url','user')),
      options_json  TEXT,
      required      INTEGER NOT NULL DEFAULT 0,
      position      INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_task_cf_proj ON task_custom_fields(project_id, position);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id                TEXT PRIMARY KEY,
      project_id        TEXT NOT NULL,
      task_key          TEXT NOT NULL UNIQUE,        -- 'WEB-42'
      parent_id         TEXT,                         -- nullable; subtask hierarchy
      type              TEXT NOT NULL DEFAULT 'task'
                        CHECK (type IN ('task','bug','feature','epic','story','spike','chore')),
      title             TEXT NOT NULL,
      description_html  TEXT,
      status_id         TEXT NOT NULL,                -- references task_workflows.statuses_json[*].id
      workflow_id       TEXT NOT NULL,
      priority          TEXT NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('urgent','high','medium','low','none')),
      estimate          REAL,
      estimate_unit     TEXT NOT NULL DEFAULT 'points'
                        CHECK (estimate_unit IN ('points','hours')),
      reporter_id       TEXT NOT NULL,
      assignee_id       TEXT,
      due_at            INTEGER,
      completed_at      INTEGER,
      position          REAL NOT NULL DEFAULT 0,
      custom_fields_json TEXT,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      deleted_at        INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_proj_status   ON tasks(project_id, status_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee      ON tasks(assignee_id, status_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_tasks_parent        ON tasks(parent_id) WHERE parent_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tasks_proj_position ON tasks(project_id, status_id, position) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_tasks_due           ON tasks(due_at) WHERE due_at IS NOT NULL AND deleted_at IS NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_participants (
      task_id    TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      role       TEXT NOT NULL CHECK (role IN ('assignee','watcher','reviewer','requester')),
      added_by   TEXT,
      added_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (task_id, user_id, role),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_parts_user ON task_participants(user_id, role);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      blocker_id  TEXT NOT NULL,                       -- this task blocks the blocked
      blocked_id  TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'blocks'
                  CHECK (kind IN ('blocks','relates_to','duplicates','clones')),
      created_by  TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (blocker_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (blocked_id) REFERENCES tasks(id) ON DELETE CASCADE,
      UNIQUE(blocker_id, blocked_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_task_deps_blocker ON task_dependencies(blocker_id);
    CREATE INDEX IF NOT EXISTS idx_task_deps_blocked ON task_dependencies(blocked_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id                TEXT PRIMARY KEY,
      task_id           TEXT NOT NULL,
      thread_id         TEXT NOT NULL,                 -- self = root else parent
      author_id         TEXT NOT NULL,
      body              TEXT NOT NULL,
      reactions_json    TEXT NOT NULL DEFAULT '{}',
      resolved          INTEGER NOT NULL DEFAULT 0,
      resolved_by       TEXT,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_cmts_task   ON task_comments(task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_cmts_thread ON task_comments(task_id, thread_id, created_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_attachments (
      id          TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL,
      uploader_id TEXT NOT NULL,
      url         TEXT NOT NULL,
      filename    TEXT,
      mime_type   TEXT,
      byte_size   INTEGER,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_atts_task ON task_attachments(task_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_links (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id       TEXT NOT NULL,
      target_kind   TEXT NOT NULL
                    CHECK (target_kind IN ('doc','dtu','lens','external','pr','commit','task')),
      target_id     TEXT,
      target_uri    TEXT,
      target_label  TEXT,
      created_by    TEXT NOT NULL,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_links_task   ON task_links(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_links_target ON task_links(target_kind, target_id) WHERE target_id IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id       TEXT NOT NULL,
      actor_id      TEXT NOT NULL,
      action        TEXT NOT NULL,                      -- 'created','status_changed','assigned','reprioritized','described','retitled','sprinted','blocked','commented','attached'
      field         TEXT,
      before_value  TEXT,
      after_value   TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_hist_task ON task_history(task_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_sprints (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL,
      name        TEXT NOT NULL,
      goal        TEXT,
      status      TEXT NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned','active','completed','archived')),
      start_at    INTEGER,
      end_at      INTEGER,
      completed_at INTEGER,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sprints_proj ON task_sprints(project_id, status, start_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_sprint_memberships (
      task_id    TEXT NOT NULL,
      sprint_id  TEXT NOT NULL,
      added_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (task_id, sprint_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (sprint_id) REFERENCES task_sprints(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sprint_mem_sprint ON task_sprint_memberships(sprint_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_labels (
      task_id  TEXT NOT NULL,
      label    TEXT NOT NULL,
      PRIMARY KEY (task_id, label),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_time_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      seconds     INTEGER NOT NULL,
      note        TEXT,
      started_at  INTEGER NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_time_task ON task_time_entries(task_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_time_user ON task_time_entries(user_id, started_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_saved_views (
      id            TEXT PRIMARY KEY,
      owner_id      TEXT NOT NULL,
      project_id    TEXT,                              -- nullable for cross-project views
      name          TEXT NOT NULL,
      view_kind     TEXT NOT NULL CHECK (view_kind IN ('list','board','calendar','timeline','gallery')),
      filters_json  TEXT,
      sort_json     TEXT,
      group_by      TEXT,
      is_default    INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_saved_views_owner ON task_saved_views(owner_id, updated_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS task_saved_views;
    DROP TABLE IF EXISTS task_time_entries;
    DROP TABLE IF EXISTS task_labels;
    DROP TABLE IF EXISTS task_sprint_memberships;
    DROP TABLE IF EXISTS task_sprints;
    DROP TABLE IF EXISTS task_history;
    DROP TABLE IF EXISTS task_links;
    DROP TABLE IF EXISTS task_attachments;
    DROP TABLE IF EXISTS task_comments;
    DROP TABLE IF EXISTS task_dependencies;
    DROP TABLE IF EXISTS task_participants;
    DROP TABLE IF EXISTS tasks;
    DROP TABLE IF EXISTS task_custom_fields;
    DROP TABLE IF EXISTS task_workflows;
    DROP TABLE IF EXISTS project_members;
    DROP TABLE IF EXISTS projects;
  `);
}
