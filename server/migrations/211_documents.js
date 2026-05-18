// server/migrations/211_documents.js
//
// Docs lens Sprint A — Item #1: real DB persistence.
//
// Today the only writing surface (creative-writing) stores everything
// in localStorage — uninstall = data gone, no cross-device, no
// collaboration, no version history. This migration lands the
// substrate so docs survive: a documents table, a per-edit version
// log enabling time travel, comments threaded by selection anchor, a
// collaborator table for role-based permissions (mirrors whiteboard
// migration 208 shape), and attachments for inline images.
//
// `document_versions` is append-only; cursor moves stay ephemeral
// (presence cache, not persisted). Backlinks are derived (recomputed
// on every save) so we don't need a separate maintenance pass.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id              TEXT PRIMARY KEY,
      owner_id        TEXT NOT NULL,
      parent_id       TEXT,                              -- nullable for top-level docs
      world_id        TEXT,                              -- optional world association
      title           TEXT NOT NULL DEFAULT 'Untitled',
      slug            TEXT,                              -- public publish slug (UNIQUE when set)
      content_html    TEXT NOT NULL DEFAULT '',
      content_md      TEXT,                              -- mirror; recomputed on save
      kind            TEXT NOT NULL DEFAULT 'doc'
                      CHECK (kind IN ('doc','note','manuscript','template','wiki')),
      visibility      TEXT NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private','shared','workspace','public')),
      icon            TEXT,                              -- emoji or short label
      cover_url       TEXT,
      meta_json       TEXT,                              -- pinned, archived, tags array, etc.
      citation_count  INTEGER NOT NULL DEFAULT 0,
      word_count      INTEGER NOT NULL DEFAULT 0,
      deleted_at      INTEGER,                           -- soft delete (NULL = live)
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (parent_id) REFERENCES documents(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_docs_owner       ON documents(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_docs_parent      ON documents(parent_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_docs_visibility  ON documents(visibility, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_docs_kind        ON documents(kind, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_slug ON documents(slug) WHERE slug IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS document_versions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id  TEXT NOT NULL,
      author_id    TEXT NOT NULL,
      snapshot_html TEXT NOT NULL,
      snapshot_md  TEXT,
      label        TEXT,                                  -- optional manual label
      reason       TEXT,                                  -- 'auto','manual','restore','import'
      word_count   INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON document_versions(document_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS document_comments (
      id              TEXT PRIMARY KEY,
      document_id     TEXT NOT NULL,
      thread_id       TEXT NOT NULL,                      -- self = root, else parent comment id
      author_id       TEXT NOT NULL,
      body            TEXT NOT NULL,
      selection_anchor INTEGER,                           -- char offset (nullable for doc-level)
      selection_focus INTEGER,
      selection_text  TEXT,                               -- snapshot for context after content drifts
      reactions_json  TEXT NOT NULL DEFAULT '{}',
      resolved        INTEGER NOT NULL DEFAULT 0,
      resolved_by     TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_doc_comments_doc    ON document_comments(document_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_doc_comments_thread ON document_comments(document_id, thread_id, created_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS document_collaborators (
      document_id  TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'editor'
                   CHECK (role IN ('owner','admin','editor','commenter','viewer')),
      invited_by   TEXT,
      invited_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      accepted_at  INTEGER,
      PRIMARY KEY (document_id, user_id),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_doc_collabs_user ON document_collaborators(user_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS document_attachments (
      id            TEXT PRIMARY KEY,
      document_id   TEXT NOT NULL,
      uploader_id   TEXT NOT NULL,
      kind          TEXT NOT NULL DEFAULT 'image'
                    CHECK (kind IN ('image','audio','video','file')),
      url           TEXT NOT NULL,
      alt           TEXT,
      byte_size     INTEGER,
      mime_type     TEXT,
      width         INTEGER,
      height        INTEGER,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_doc_attachments_doc ON document_attachments(document_id, created_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS document_backlinks (
      source_doc_id TEXT NOT NULL,
      target_doc_id TEXT,                                 -- nullable for DTU/lens links
      target_dtu_id TEXT,                                 -- nullable for doc→doc links
      target_kind   TEXT NOT NULL DEFAULT 'doc'
                    CHECK (target_kind IN ('doc','dtu','lens','external')),
      target_label  TEXT,                                 -- display label captured at write time
      target_uri    TEXT,                                 -- full uri for external/lens links
      position      INTEGER NOT NULL DEFAULT 0,           -- char offset in source content
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (source_doc_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_doc_backlinks_source ON document_backlinks(source_doc_id);
    CREATE INDEX IF NOT EXISTS idx_doc_backlinks_target ON document_backlinks(target_doc_id, source_doc_id);
    CREATE INDEX IF NOT EXISTS idx_doc_backlinks_dtu    ON document_backlinks(target_dtu_id, source_doc_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS document_backlinks;
    DROP TABLE IF EXISTS document_attachments;
    DROP TABLE IF EXISTS document_collaborators;
    DROP TABLE IF EXISTS document_comments;
    DROP TABLE IF EXISTS document_versions;
    DROP TABLE IF EXISTS documents;
  `);
}
