// server/migrations/209_messaging_substrate.js
//
// Message lens Sprint A #1 — real DB substrate for DMs / group DMs /
// channels / threads / presence / drafts / bookmarks.
//
// Pre-Sprint-A reality: DMs live only in `STATE._social.messages`
// (in-memory Map). Server restart = every conversation wiped. This
// migration lands the real tables so messaging matches the whiteboard
// + studio + code patterns: STATE stays as hot cache, source of truth
// is SQLite.
//
// Notes:
//  - `conversations.kind` covers all three shapes (dm / group / channel).
//  - `messages.parent_message_id` powers nested threads.
//  - `mentions_json` is denormalised on the message row for fast inbox
//    filtering ("@me" view) without a separate join table.
//  - All FK CASCADE on conversation delete.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id           TEXT PRIMARY KEY,
      kind         TEXT NOT NULL DEFAULT 'dm'
                   CHECK (kind IN ('dm','group','channel','external')),
      title        TEXT,
      topic        TEXT,
      workspace_id TEXT,
      owner_id     TEXT,
      external_source TEXT,                   -- 'slack' | 'discord' | … for kind='external'
      meta_json    TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_conv_kind ON conversations(kind, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conv_owner ON conversations(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conv_workspace ON conversations(workspace_id, kind);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id       TEXT NOT NULL,
      user_id               TEXT NOT NULL,
      role                  TEXT NOT NULL DEFAULT 'member'
                            CHECK (role IN ('owner','admin','member','guest')),
      last_read_message_id  TEXT,
      muted_until           INTEGER,
      joined_at             INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_conv_parts_user ON conversation_participants(user_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id                 TEXT PRIMARY KEY,
      conversation_id    TEXT NOT NULL,
      parent_message_id  TEXT,                              -- nested threads
      author_id          TEXT NOT NULL,
      body               TEXT,
      body_kind          TEXT NOT NULL DEFAULT 'text'
                         CHECK (body_kind IN ('text','voice','file','dtu_embed','system')),
      attachments_json   TEXT,
      mentions_json      TEXT DEFAULT '[]',
      reactions_json     TEXT NOT NULL DEFAULT '{}',
      pinned             INTEGER NOT NULL DEFAULT 0,
      edited_at          INTEGER,
      deleted_at         INTEGER,
      scheduled_for      INTEGER,                            -- send-later
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      server_ts          INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, server_ts);
    CREATE INDEX IF NOT EXISTS idx_msg_parent ON messages(parent_message_id, server_ts);
    CREATE INDEX IF NOT EXISTS idx_msg_author ON messages(author_id, server_ts DESC);
    CREATE INDEX IF NOT EXISTS idx_msg_scheduled ON messages(scheduled_for) WHERE scheduled_for IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_msg_pinned ON messages(conversation_id, pinned) WHERE pinned = 1;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_read_receipts (
      message_id  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      read_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_msg_reads_user ON message_read_receipts(user_id, read_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS drafts (
      user_id          TEXT NOT NULL,
      conversation_id  TEXT NOT NULL,
      parent_message_id TEXT,                            -- thread draft
      body             TEXT NOT NULL DEFAULT '',
      attachments_json TEXT,
      updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, conversation_id, parent_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id, updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      user_id      TEXT NOT NULL,
      message_id   TEXT NOT NULL,
      note         TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, message_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS thread_subscriptions (
      user_id          TEXT NOT NULL,
      conversation_id  TEXT NOT NULL,
      snoozed_until    INTEGER,
      tag              TEXT,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, conversation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_thread_sub_snoozed ON thread_subscriptions(snoozed_until) WHERE snoozed_until IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_thread_sub_tag ON thread_subscriptions(user_id, tag) WHERE tag IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_presence (
      user_id        TEXT PRIMARY KEY,
      status         TEXT NOT NULL DEFAULT 'offline'
                     CHECK (status IN ('online','away','dnd','focus','offline')),
      custom_text    TEXT,
      focus_until    INTEGER,
      updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_attachments (
      id           TEXT PRIMARY KEY,
      message_id   TEXT,                                  -- nullable so an upload can outlive its message
      owner_id     TEXT NOT NULL,
      conversation_id TEXT,
      path         TEXT NOT NULL,                         -- relative to data/message-attachments/
      mime         TEXT,
      bytes        INTEGER,
      dtu_id       TEXT,                                  -- kind='message_attachment' DTU
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_msg_att_owner ON message_attachments(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_msg_att_message ON message_attachments(message_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS message_attachments;
    DROP TABLE IF EXISTS user_presence;
    DROP TABLE IF EXISTS thread_subscriptions;
    DROP TABLE IF EXISTS bookmarks;
    DROP TABLE IF EXISTS drafts;
    DROP TABLE IF EXISTS message_read_receipts;
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS conversation_participants;
    DROP TABLE IF EXISTS conversations;
  `);
}
