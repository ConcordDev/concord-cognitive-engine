// server/migrations/224_chat_ai_surface.js
//
// Chat lens Sprint B — Canvas/Artifacts + Deep Research + tool
// logs substrate.
//
//   chat_artifacts          — Claude-Artifacts-parity inline blocks
//                              attached to a chat message; rendered in
//                              the right-side Canvas panel. Versioned.
//   chat_artifact_versions  — full version history (revert / diff)
//   chat_research_runs      — Deep Research plan-then-execute reports
//   chat_tool_calls         — per-message tool-call audit (function
//                              calling visibility — what was called,
//                              with what args, what came back)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_artifacts (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      message_idx     INTEGER NOT NULL,
      owner_id        TEXT NOT NULL,
      kind            TEXT NOT NULL DEFAULT 'code'
                      CHECK (kind IN ('code','html','svg','markdown','mermaid','react','json','csv','sql','prompt')),
      title           TEXT,
      language        TEXT,                                    -- javascript / python / etc (when kind=code)
      body            TEXT NOT NULL,                           -- current content
      current_version INTEGER NOT NULL DEFAULT 1,
      dtu_id          TEXT,                                    -- when minted
      visibility      TEXT NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private','workspace','public')),
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_chart_session ON chat_artifacts(session_id, message_idx);
    CREATE INDEX IF NOT EXISTS idx_chart_owner   ON chat_artifacts(owner_id, updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_artifact_versions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id  TEXT NOT NULL,
      version      INTEGER NOT NULL,
      body         TEXT NOT NULL,
      author       TEXT NOT NULL,                              -- user_id or 'llm'
      author_kind  TEXT NOT NULL DEFAULT 'user'
                   CHECK (author_kind IN ('user','llm','agent')),
      note         TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (artifact_id) REFERENCES chat_artifacts(id) ON DELETE CASCADE,
      UNIQUE(artifact_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_chartv_artifact ON chat_artifact_versions(artifact_id, version DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_research_runs (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      query           TEXT NOT NULL,
      plan_json       TEXT,                                    -- step list
      sources_json    TEXT,                                    -- [{url, title, snippet}]
      report_md       TEXT,                                    -- final report
      status          TEXT NOT NULL DEFAULT 'planning'
                      CHECK (status IN ('planning','executing','complete','failed','cancelled')),
      step_count      INTEGER NOT NULL DEFAULT 0,
      tokens          INTEGER NOT NULL DEFAULT 0,
      source          TEXT NOT NULL DEFAULT 'llm'
                      CHECK (source IN ('llm','fallback','deterministic')),
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_chresearch_session ON chat_research_runs(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chresearch_user    ON chat_research_runs(user_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_tool_calls (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id     TEXT NOT NULL,
      message_idx    INTEGER NOT NULL,
      tool           TEXT NOT NULL,                            -- 'web_search','run_compute','create_dtu','browser_act','run_lens_action','memory_recall',...
      args_json      TEXT,
      result_json    TEXT,
      success        INTEGER NOT NULL DEFAULT 1,
      latency_ms     INTEGER,
      tokens         INTEGER NOT NULL DEFAULT 0,
      brain_slot     TEXT,                                     -- which brain handled this call
      created_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_chtool_session ON chat_tool_calls(session_id, message_idx);
    CREATE INDEX IF NOT EXISTS idx_chtool_tool    ON chat_tool_calls(tool, created_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS chat_tool_calls;
    DROP TABLE IF EXISTS chat_research_runs;
    DROP TABLE IF EXISTS chat_artifact_versions;
    DROP TABLE IF EXISTS chat_artifacts;
  `);
}
