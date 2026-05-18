// server/migrations/225_chat_moats.js
//
// Chat lens Sprint C — concord-native moats.
//
//   chat_session_mints  — when a saved chat is minted as a
//                          chat_session DTU + royalty cascade receipt
//   chat_persona_mints  — when a persona is published as an
//                          agent_spec DTU
//   chat_public_links   — Calendly/Notion-style public-read tokens
//                          for shared conversations
//   chat_council_runs   — 5-brain council mode (multi-brain debate)
//                          per-run audit + final synthesis

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_session_mints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL UNIQUE,
      dtu_id          TEXT NOT NULL UNIQUE,
      creator_id      TEXT NOT NULL,
      royalty_rate    REAL NOT NULL DEFAULT 0.21,
      visibility      TEXT NOT NULL DEFAULT 'workspace'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      allow_citation  INTEGER NOT NULL DEFAULT 1,
      citation_count  INTEGER NOT NULL DEFAULT 0,
      minted_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_chsm_creator ON chat_session_mints(creator_id, minted_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_persona_mints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      persona_id      TEXT NOT NULL UNIQUE,
      dtu_id          TEXT NOT NULL UNIQUE,
      creator_id      TEXT NOT NULL,
      royalty_rate    REAL NOT NULL DEFAULT 0.21,
      visibility      TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      install_count   INTEGER NOT NULL DEFAULT 0,
      minted_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_chpm_creator ON chat_persona_mints(creator_id, minted_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_public_links (
      id              TEXT PRIMARY KEY,                       -- public slug
      session_id      TEXT NOT NULL,
      owner_id        TEXT NOT NULL,
      title           TEXT,
      visibility      TEXT NOT NULL DEFAULT 'read_only'
                      CHECK (visibility IN ('read_only','readable_branchable')),
      expires_at      INTEGER,                                 -- nullable; null = no expiry
      access_count    INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER,
      active          INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_chpl_owner ON chat_public_links(owner_id, active);
    CREATE INDEX IF NOT EXISTS idx_chpl_session ON chat_public_links(session_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_council_runs (
      id              TEXT PRIMARY KEY,
      session_id      TEXT,
      user_id         TEXT NOT NULL,
      question        TEXT NOT NULL,
      brains_json     TEXT NOT NULL,                           -- array of brain slots invited to the council
      responses_json  TEXT,                                    -- {brainSlot: response} after each brain weighs in
      synthesis       TEXT,                                    -- final synthesized answer
      status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','collecting','synthesizing','complete','failed')),
      tokens          INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_chcouncil_user ON chat_council_runs(user_id, created_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS chat_council_runs;
    DROP TABLE IF EXISTS chat_public_links;
    DROP TABLE IF EXISTS chat_persona_mints;
    DROP TABLE IF EXISTS chat_session_mints;
  `);
}
