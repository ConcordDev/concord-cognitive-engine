// server/migrations/213_doc_extensions.js
//
// Docs Sprint C — embeds + agents + concord-native moats.
//
// doc_templates    — reusable page scaffolds (compose / meeting notes
//                    / spec / RFC / OKR / etc.) per Notion's
//                    template-gallery pattern. Authored once,
//                    instantiated cheaply.
// doc_databases    — Notion-DB-style structured pages: a doc gets a
//                    typed schema + tabular rows that share an editor.
// doc_database_rows — one row of the structured page; properties_json
//                    matches the database's schema.
// doc_page_agents  — page-bound agents (Notion Agents parity).
//                    System prompt + capabilities scoped to a single
//                    doc; can be published as agent_spec DTU.
// doc_mints        — record-of-mint when a doc becomes a citable DTU.
//                    Royalty rate captured at mint time so cascading
//                    revenue follows the agreed cut even if the
//                    invariant table later evolves.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_templates (
      id            TEXT PRIMARY KEY,
      owner_id      TEXT NOT NULL,
      name          TEXT NOT NULL,
      description   TEXT,
      category      TEXT NOT NULL DEFAULT 'general'
                    CHECK (category IN ('general','meeting','spec','rfc','okr','journal','onboarding','retro','postmortem','plan','custom')),
      content_html  TEXT NOT NULL DEFAULT '',
      icon          TEXT,
      visibility    TEXT NOT NULL DEFAULT 'private'
                    CHECK (visibility IN ('private','workspace','public')),
      usage_count   INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_doc_templates_owner ON doc_templates(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_doc_templates_vis   ON doc_templates(visibility, usage_count DESC);
    CREATE INDEX IF NOT EXISTS idx_doc_templates_cat   ON doc_templates(category, usage_count DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_databases (
      id           TEXT PRIMARY KEY,
      document_id  TEXT NOT NULL,
      owner_id     TEXT NOT NULL,
      name         TEXT NOT NULL DEFAULT 'Untitled database',
      schema_json  TEXT NOT NULL,                    -- [{id,name,type,options}]
      view_json    TEXT,                             -- column order, filters, sorts
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_doc_databases_doc ON doc_databases(document_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_database_rows (
      id              TEXT PRIMARY KEY,
      database_id     TEXT NOT NULL,
      properties_json TEXT NOT NULL,                  -- { columnId: value }
      sort_key        INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (database_id) REFERENCES doc_databases(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_doc_db_rows_db ON doc_database_rows(database_id, sort_key);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_page_agents (
      id              TEXT PRIMARY KEY,
      document_id     TEXT NOT NULL,
      owner_id        TEXT NOT NULL,
      name            TEXT NOT NULL,
      description     TEXT,
      system_prompt   TEXT NOT NULL,
      capabilities_json TEXT,                         -- ["read_doc","read_comments","write_section","query_workspace"]
      slot            TEXT NOT NULL DEFAULT 'utility'
                      CHECK (slot IN ('conscious','subconscious','utility','repair','multimodal')),
      dtu_id          TEXT,                           -- non-null once published as agent_spec DTU
      active          INTEGER NOT NULL DEFAULT 1,
      invocation_count INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_doc_agents_doc ON doc_page_agents(document_id, active);
    CREATE INDEX IF NOT EXISTS idx_doc_agents_dtu ON doc_page_agents(dtu_id) WHERE dtu_id IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_mints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id     TEXT NOT NULL UNIQUE,
      dtu_id          TEXT NOT NULL UNIQUE,
      creator_id      TEXT NOT NULL,
      royalty_rate    REAL NOT NULL DEFAULT 0.21,
      visibility      TEXT NOT NULL DEFAULT 'workspace'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      allow_citation  INTEGER NOT NULL DEFAULT 1,
      citation_count  INTEGER NOT NULL DEFAULT 0,
      minted_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_doc_mints_creator ON doc_mints(creator_id, minted_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS doc_mints;
    DROP TABLE IF EXISTS doc_page_agents;
    DROP TABLE IF EXISTS doc_database_rows;
    DROP TABLE IF EXISTS doc_databases;
    DROP TABLE IF EXISTS doc_templates;
  `);
}
