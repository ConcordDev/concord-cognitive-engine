// server/migrations/212_doc_ai.js
//
// Docs Sprint B — AI surface substrate.
//
// `doc_skills` — Custom AI Skills, the Notion 3.4 flagship feature.
// Saves a workflow ("draft a weekly update in our team's format") as
// a reusable named prompt that runs against the current doc + extra
// context. Author-private by default; can be shared per-org later.
//
// `doc_ai_runs` — append-only ledger of every AI invocation against a
// doc. Used by version history + audit + the Q&A "where did the AI
// pull this answer from" provenance.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_skills (
      id            TEXT PRIMARY KEY,
      owner_id      TEXT NOT NULL,
      name          TEXT NOT NULL,
      description   TEXT,
      prompt        TEXT NOT NULL,
      kind          TEXT NOT NULL DEFAULT 'rewrite'
                    CHECK (kind IN ('rewrite','compose','analyze','format','custom')),
      visibility    TEXT NOT NULL DEFAULT 'private'
                    CHECK (visibility IN ('private','workspace','public')),
      input_schema  TEXT,                              -- optional JSON schema for the inputs the skill accepts
      example_input TEXT,
      run_count     INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_doc_skills_owner ON doc_skills(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_doc_skills_vis   ON doc_skills(visibility, updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_ai_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id  TEXT,                               -- null for compose-from-nothing
      user_id      TEXT NOT NULL,
      kind         TEXT NOT NULL,                      -- compose|inline_edit|continue|qa|match_style|match_format|skill|voice|image
      skill_id     TEXT,                               -- nullable; set when invoked via a Custom Skill
      prompt       TEXT,
      selection_text TEXT,                             -- the slice the user had highlighted (for inline_edit)
      response     TEXT NOT NULL,                      -- the raw LLM output (truncated)
      source       TEXT NOT NULL DEFAULT 'llm'
                   CHECK (source IN ('llm','fallback','deterministic')),
      latency_ms   INTEGER,
      tokens_in    INTEGER,
      tokens_out   INTEGER,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_doc_ai_runs_doc   ON doc_ai_runs(document_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_doc_ai_runs_user  ON doc_ai_runs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_doc_ai_runs_skill ON doc_ai_runs(skill_id, created_at DESC) WHERE skill_id IS NOT NULL;
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS doc_ai_runs;
    DROP TABLE IF EXISTS doc_skills;
  `);
}
