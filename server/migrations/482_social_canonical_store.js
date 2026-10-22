// Canonical social store. The in-memory STATE._social maps are a cache.
// These tables are the restart copy. social_posts (migration 315) stays the
// short GDPR mirror; social_post_records holds the full post.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_profiles (
      user_id TEXT PRIMARY KEY,
      display_name TEXT,
      bio TEXT,
      avatar_url TEXT,
      website TEXT,
      is_public INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS social_follows (
      follower_id TEXT NOT NULL,
      followed_id TEXT NOT NULL,
      created_at TEXT,
      PRIMARY KEY (follower_id, followed_id)
    );

    CREATE TABLE IF NOT EXISTS social_post_records (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      content TEXT,
      privacy TEXT,
      created_at TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_social_post_records_user ON social_post_records(user_id);

    CREATE TABLE IF NOT EXISTS social_replies (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      parent_id TEXT,
      user_id TEXT,
      body TEXT,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_social_replies_post ON social_replies(post_id);

    CREATE TABLE IF NOT EXISTS social_reactions (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'lens',
      PRIMARY KEY (post_id, user_id, source)
    );

    CREATE TABLE IF NOT EXISTS social_bookmarks (
      user_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      created_at TEXT,
      PRIMARY KEY (user_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS social_dm_threads (
      id TEXT PRIMARY KEY,
      participant_a TEXT NOT NULL,
      participant_b TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS social_dm_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      from_user_id TEXT,
      to_user_id TEXT,
      body TEXT,
      created_at TEXT,
      read_by_json TEXT,
      recalled INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_social_dm_messages_thread ON social_dm_messages(thread_id);

    CREATE TABLE IF NOT EXISTS social_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT,
      from_user_id TEXT,
      post_id TEXT,
      content TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_social_notifications_user ON social_notifications(user_id);

    CREATE TABLE IF NOT EXISTS social_blocks (
      user_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      PRIMARY KEY (user_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS social_mutes (
      user_id TEXT NOT NULL,
      muted_id TEXT NOT NULL,
      PRIMARY KEY (user_id, muted_id)
    );

    CREATE TABLE IF NOT EXISTS social_reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT,
      target_type TEXT,
      target_id TEXT,
      reason TEXT,
      payload_json TEXT,
      created_at TEXT
    );
  `);

  const cols = new Set(db.prepare("PRAGMA table_info(social_posts)").all().map((c) => c.name));
  if (cols.size && !cols.has("payload_json")) {
    db.exec("ALTER TABLE social_posts ADD COLUMN payload_json TEXT");
  }
  if (cols.size && !cols.has("privacy")) {
    db.exec("ALTER TABLE social_posts ADD COLUMN privacy TEXT");
  }
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS social_reports;
    DROP TABLE IF EXISTS social_mutes;
    DROP TABLE IF EXISTS social_blocks;
    DROP TABLE IF EXISTS social_notifications;
    DROP TABLE IF EXISTS social_dm_messages;
    DROP TABLE IF EXISTS social_dm_threads;
    DROP TABLE IF EXISTS social_bookmarks;
    DROP TABLE IF EXISTS social_reactions;
    DROP TABLE IF EXISTS social_replies;
    DROP TABLE IF EXISTS social_post_records;
    DROP TABLE IF EXISTS social_follows;
    DROP TABLE IF EXISTS social_profiles;
  `);
}

export const description = "Persist the canonical social store (profiles, posts, follows, DMs, notifications, blocks)";
