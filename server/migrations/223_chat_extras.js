// server/migrations/223_chat_extras.js
//
// Chat lens Sprint A — memory + projects + personas + scheduled
// tasks + branches persistence. Layers on top of migration 193
// (chat_sessions + chat_messages).
//
// Eight tables — most of these existed only as in-memory STATE
// before this migration, even though the dead /domains/chat.js
// (760 LOC, 21 legacy handlers, 70+ passing tests) was a complete
// implementation. Sprint A wires that file + persists what was
// transient.
//
//   chat_user_memory        — ChatGPT-style auto cross-session memory
//   chat_projects           — Claude-Projects-style persistent workspace
//   chat_project_members    — collaborators on a project
//   chat_project_attached_dtus — DTUs in a project's context
//   chat_personas           — custom personas (per-user; publishable as DTU)
//   chat_prompts            — user prompt library
//   chat_scheduled_tasks    — Tasks parity (scheduled recurring chats)
//   chat_message_branches   — fork-from-message audit (so the UI
//                              can render the tree)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_user_memory (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT NOT NULL,
      project_id   TEXT,                                   -- null = global memory
      fact         TEXT NOT NULL,                          -- one-liner
      kind         TEXT NOT NULL DEFAULT 'preference'
                   CHECK (kind IN ('preference','identity','goal','context','constraint','fact')),
      source_session_id TEXT,
      confidence   REAL NOT NULL DEFAULT 0.7,
      enabled      INTEGER NOT NULL DEFAULT 1,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      hit_count    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_mem_user    ON chat_user_memory(user_id, enabled, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mem_project ON chat_user_memory(project_id, enabled) WHERE project_id IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_projects (
      id              TEXT PRIMARY KEY,
      owner_id        TEXT NOT NULL,
      name            TEXT NOT NULL,
      description     TEXT,
      icon            TEXT,
      color           TEXT DEFAULT '#22d3ee',
      system_prompt   TEXT,                                 -- per-project persona / instructions
      brain_preference TEXT,                                -- preferred brain slot for this project
      temperature     REAL,
      visibility      TEXT NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private','team','workspace','public')),
      dtu_id          TEXT,                                 -- when minted
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      archived_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_chproj_owner ON chat_projects(owner_id, updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_project_members (
      project_id TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'member'
                 CHECK (role IN ('owner','admin','member','viewer')),
      added_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (project_id, user_id),
      FOREIGN KEY (project_id) REFERENCES chat_projects(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_project_attached_dtus (
      project_id  TEXT NOT NULL,
      dtu_id      TEXT NOT NULL,
      attached_by TEXT NOT NULL,
      attached_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (project_id, dtu_id),
      FOREIGN KEY (project_id) REFERENCES chat_projects(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_personas (
      id            TEXT PRIMARY KEY,
      owner_id      TEXT NOT NULL,
      name          TEXT NOT NULL,
      description   TEXT,
      icon          TEXT,
      system_prompt TEXT NOT NULL,
      brain_slot    TEXT NOT NULL DEFAULT 'conscious'
                    CHECK (brain_slot IN ('conscious','subconscious','utility','repair','multimodal')),
      style_vector_json TEXT,                                -- pinned style hints
      tool_allowlist_json TEXT,                              -- subset of available tools
      visibility    TEXT NOT NULL DEFAULT 'private'
                    CHECK (visibility IN ('private','workspace','public')),
      dtu_id        TEXT,                                    -- when published
      usage_count   INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_persona_owner ON chat_personas(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_persona_vis   ON chat_personas(visibility, usage_count DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_prompts (
      id          TEXT PRIMARY KEY,
      owner_id    TEXT NOT NULL,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL,                              -- template with {{vars}}
      category    TEXT,
      tags_json   TEXT,
      visibility  TEXT NOT NULL DEFAULT 'private'
                  CHECK (visibility IN ('private','workspace','public')),
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_chprompt_owner ON chat_prompts(owner_id, updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_scheduled_tasks (
      id           TEXT PRIMARY KEY,
      owner_id     TEXT NOT NULL,
      project_id   TEXT,
      persona_id   TEXT,
      title        TEXT NOT NULL,
      prompt       TEXT NOT NULL,
      cadence_kind TEXT NOT NULL DEFAULT 'every_n_hours'
                   CHECK (cadence_kind IN ('every_n_hours','daily','weekly','once_at')),
      cadence_param TEXT NOT NULL,
      next_run_at  INTEGER NOT NULL,
      last_run_at  INTEGER,
      last_session_id TEXT,
      enabled      INTEGER NOT NULL DEFAULT 1,
      run_count    INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_chsched_owner ON chat_scheduled_tasks(owner_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_chsched_due   ON chat_scheduled_tasks(enabled, next_run_at) WHERE enabled = 1;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_message_branches (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      parent_message_idx INTEGER NOT NULL,
      branched_session_id TEXT NOT NULL,                     -- the new session id created at fork
      branched_by     TEXT NOT NULL,
      reason          TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_chbranch_session ON chat_message_branches(session_id, parent_message_idx);
    CREATE INDEX IF NOT EXISTS idx_chbranch_new     ON chat_message_branches(branched_session_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS chat_message_branches;
    DROP TABLE IF EXISTS chat_scheduled_tasks;
    DROP TABLE IF EXISTS chat_prompts;
    DROP TABLE IF EXISTS chat_personas;
    DROP TABLE IF EXISTS chat_project_attached_dtus;
    DROP TABLE IF EXISTS chat_project_members;
    DROP TABLE IF EXISTS chat_projects;
    DROP TABLE IF EXISTS chat_user_memory;
  `);
}
