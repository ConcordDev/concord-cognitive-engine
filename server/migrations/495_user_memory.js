// Per-user persistent memory (opt-in, default off at the feature-flag level).
// Private by construction: every row carries a NOT NULL user_id, nothing here is a DTU, and nothing is ever
// written to the global DTU embedding index. Additive only; see lib/user-memory.js for the only code allowed
// to touch these tables.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_memory_settings (
      user_id    TEXT PRIMARY KEY,
      enabled    INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_memory_projects_off (
      user_id    TEXT NOT NULL,
      project_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS user_memory_facts (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL,
      project_id        TEXT,
      kind              TEXT NOT NULL CHECK (kind IN ('preference','goal','entity','fact')),
      subject           TEXT NOT NULL,
      predicate         TEXT NOT NULL,
      value             TEXT NOT NULL,
      embedding         BLOB,
      salience          REAL NOT NULL DEFAULT 1.0,
      status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','pending')),
      supersedes_id     TEXT,
      valid_from        INTEGER NOT NULL,
      valid_to          INTEGER,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      last_used_at      INTEGER,
      use_count         INTEGER NOT NULL DEFAULT 0,
      source_session_id TEXT,
      source_msg_id     TEXT,
      source_text       TEXT,
      user_edited       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_umf_user_status ON user_memory_facts(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_umf_user_project ON user_memory_facts(user_id, project_id, status);
    -- At most one ACTIVE fact per (user, project, subject, predicate): that is what makes supersede atomic.
    CREATE UNIQUE INDEX IF NOT EXISTS uq_umf_active_key
      ON user_memory_facts(user_id, COALESCE(project_id, ''), subject, predicate) WHERE status = 'active';

    -- Graph edges: a memory is linked to the project / lens / DTU it is about.
    CREATE TABLE IF NOT EXISTS user_memory_links (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT NOT NULL,
      fact_id     TEXT NOT NULL,
      target_kind TEXT NOT NULL CHECK (target_kind IN ('project','lens','dtu')),
      target_id   TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      UNIQUE (fact_id, target_kind, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_uml_user_target ON user_memory_links(user_id, target_kind, target_id);

    -- Which memories a reply used (powers "used in this reply" + "why did you remember this").
    CREATE TABLE IF NOT EXISTS user_memory_uses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL,
      fact_id    TEXT NOT NULL,
      session_id TEXT,
      msg_id     TEXT,
      used_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_umu_user_msg ON user_memory_uses(user_id, session_id, msg_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS user_memory_uses;
    DROP TABLE IF EXISTS user_memory_links;
    DROP TABLE IF EXISTS user_memory_facts;
    DROP TABLE IF EXISTS user_memory_projects_off;
    DROP TABLE IF EXISTS user_memory_settings;
  `);
}

export const description = "Per-user opt-in persistent memory: facts, graph links, usage log (private, user_id-scoped)";
