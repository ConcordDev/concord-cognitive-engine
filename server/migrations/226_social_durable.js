// server/migrations/226_social_durable.js
//
// Social lens Sprint A — durable persistence + edit history + quotes
// + multi-image + the missing following-activity audit.
//
// Pre-this-migration: 76 functions in emergent/social-layer.js
// stored everything in STATE._social Maps. Posts, DMs, notifications,
// follows, reactions — all lost on restart. Reels were the lone DB-
// backed exception. This migration brings everything else into the
// database while keeping the function signatures stable so the
// existing 73 routes don't need to change shape.
//
// Also lands the missing pieces the audit found:
//   social_post_media     — multi-image + video attached to posts
//   social_post_edits     — edit history (X / Bluesky / Threads parity)
//   social_post_quotes    — quote posts with attribution
//   social_following_activity — backing table for the route the
//                                lens page calls + the server never
//                                implemented (the critical 404)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_posts (
      id              TEXT PRIMARY KEY,
      author_id       TEXT NOT NULL,
      kind            TEXT NOT NULL DEFAULT 'post'
                      CHECK (kind IN ('post','reply','quote','article','reel','story','dtu_share')),
      parent_post_id  TEXT,                              -- for replies
      quoted_post_id  TEXT,                              -- for quote posts
      title           TEXT,                              -- for articles
      content         TEXT NOT NULL,
      content_format  TEXT NOT NULL DEFAULT 'plain'
                      CHECK (content_format IN ('plain','markdown','html')),
      visibility      TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('public','followers','workspace','private','federated')),
      sensitive       INTEGER NOT NULL DEFAULT 0,
      content_warning TEXT,
      dtu_id          TEXT,                              -- set when post is minted
      edit_count      INTEGER NOT NULL DEFAULT 0,
      reply_count     INTEGER NOT NULL DEFAULT 0,
      reaction_count  INTEGER NOT NULL DEFAULT 0,
      repost_count    INTEGER NOT NULL DEFAULT 0,
      quote_count     INTEGER NOT NULL DEFAULT 0,
      bookmark_count  INTEGER NOT NULL DEFAULT 0,
      view_count      INTEGER NOT NULL DEFAULT 0,
      pinned          INTEGER NOT NULL DEFAULT 0,
      scheduled_at    INTEGER,                            -- set when scheduled, null when published
      published_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      deleted_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sposts_author ON social_posts(author_id, published_at DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_sposts_parent ON social_posts(parent_post_id) WHERE parent_post_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sposts_quoted ON social_posts(quoted_post_id) WHERE quoted_post_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sposts_pub    ON social_posts(visibility, published_at DESC) WHERE deleted_at IS NULL AND visibility IN ('public','federated');
    CREATE INDEX IF NOT EXISTS idx_sposts_sched  ON social_posts(scheduled_at) WHERE scheduled_at IS NOT NULL AND published_at = 0;
    CREATE INDEX IF NOT EXISTS idx_sposts_dtu    ON social_posts(dtu_id) WHERE dtu_id IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_post_media (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id        TEXT NOT NULL,
      position       INTEGER NOT NULL DEFAULT 0,
      kind           TEXT NOT NULL CHECK (kind IN ('image','video','audio','gif','link','poll')),
      url            TEXT,
      alt_text       TEXT,
      mime_type      TEXT,
      byte_size      INTEGER,
      width          INTEGER,
      height         INTEGER,
      duration_ms    INTEGER,
      meta_json      TEXT,                                -- poll options, etc
      created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_spm_post ON social_post_media(post_id, position);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_post_edits (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id        TEXT NOT NULL,
      revision       INTEGER NOT NULL,
      content_before TEXT NOT NULL,
      content_after  TEXT NOT NULL,
      editor_id      TEXT NOT NULL,
      edited_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE,
      UNIQUE(post_id, revision)
    );
    CREATE INDEX IF NOT EXISTS idx_spe_post ON social_post_edits(post_id, revision DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_reactions (
      post_id      TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      kind         TEXT NOT NULL DEFAULT 'like'
                   CHECK (kind IN ('like','heart','laugh','wow','sad','angry','celebrate','insightful')),
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (post_id, user_id, kind),
      FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sreact_user ON social_reactions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sreact_post ON social_reactions(post_id, kind);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_follows (
      follower_id  TEXT NOT NULL,
      followee_id  TEXT NOT NULL,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (follower_id, followee_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sfollows_followee ON social_follows(followee_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sfollows_follower ON social_follows(follower_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_bookmarks (
      user_id      TEXT NOT NULL,
      post_id      TEXT NOT NULL,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, post_id),
      FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sbm_user ON social_bookmarks(user_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_reposts (
      user_id      TEXT NOT NULL,
      post_id      TEXT NOT NULL,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, post_id),
      FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sreposts_user ON social_reposts(user_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_notifications (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT NOT NULL,                       -- recipient
      actor_id     TEXT,                                 -- who triggered (null for system)
      kind         TEXT NOT NULL
                   CHECK (kind IN ('reply','reaction','repost','quote','follow','mention','dm','system','badge','citation')),
      subject_id   TEXT,                                 -- post_id / user_id / dtu_id depending on kind
      preview      TEXT,
      read_at      INTEGER,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_snotif_user ON social_notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_snotif_unread ON social_notifications(user_id, read_at) WHERE read_at IS NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,                    -- sorted pair "userA|userB" or group:<id>
      sender_id       TEXT NOT NULL,
      content         TEXT NOT NULL,
      media_json      TEXT,
      reply_to_id     INTEGER,
      reactions_json  TEXT NOT NULL DEFAULT '{}',
      read_at         INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      recalled_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sdm_conv ON social_messages(conversation_id, created_at DESC) WHERE recalled_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_sdm_sender ON social_messages(sender_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_blocks (
      user_id     TEXT NOT NULL,
      blocked_id  TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'block'
                  CHECK (kind IN ('block','mute','keyword_mute')),
      keyword     TEXT NOT NULL DEFAULT '',              -- for keyword_mute (empty for block/mute)
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, blocked_id, kind, keyword)
    );
    CREATE INDEX IF NOT EXISTS idx_sblocks_user ON social_blocks(user_id, kind);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_following_activity (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT NOT NULL,                       -- the user whose followees did something
      actor_id     TEXT NOT NULL,                       -- the followee
      kind         TEXT NOT NULL                        -- 'post','reply','reaction','repost','follow','quote'
                   CHECK (kind IN ('post','reply','reaction','repost','follow','quote')),
      subject_id   TEXT,                                 -- post_id / user_id
      preview      TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_sfa_user ON social_following_activity(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sfa_actor ON social_following_activity(actor_id, created_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS social_following_activity;
    DROP TABLE IF EXISTS social_blocks;
    DROP TABLE IF EXISTS social_messages;
    DROP TABLE IF EXISTS social_notifications;
    DROP TABLE IF EXISTS social_reposts;
    DROP TABLE IF EXISTS social_bookmarks;
    DROP TABLE IF EXISTS social_follows;
    DROP TABLE IF EXISTS social_reactions;
    DROP TABLE IF EXISTS social_post_edits;
    DROP TABLE IF EXISTS social_post_media;
    DROP TABLE IF EXISTS social_posts;
  `);
}
