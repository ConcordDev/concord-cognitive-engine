// server/migrations/228_social_moats.js
//
// Social lens Sprint C — concord-native moats.
//
//   social_post_mints      — when a post is minted as a citable
//                             social_post DTU + royalty cascade
//                             receipt
//   social_algo_mints      — when a custom feed algorithm is
//                             published as an agent_spec DTU
//                             (subscribe → royalty fires)
//   social_federation_outbox_status — heartbeat-friendly processing
//                             state for the existing migration-198
//                             outbox (pending/sent/failed + retries)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_post_mints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id         TEXT NOT NULL UNIQUE,
      dtu_id          TEXT NOT NULL UNIQUE,
      creator_id      TEXT NOT NULL,
      royalty_rate    REAL NOT NULL DEFAULT 0.21,
      visibility      TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      allow_citation  INTEGER NOT NULL DEFAULT 1,
      citation_count  INTEGER NOT NULL DEFAULT 0,
      minted_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_spmint_creator ON social_post_mints(creator_id, minted_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_algo_mints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      algo_id         TEXT NOT NULL UNIQUE,
      dtu_id          TEXT NOT NULL UNIQUE,
      creator_id      TEXT NOT NULL,
      royalty_rate    REAL NOT NULL DEFAULT 0.21,
      visibility      TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('private','workspace','public','published','global')),
      subscriber_count_at_mint INTEGER NOT NULL DEFAULT 0,
      install_count   INTEGER NOT NULL DEFAULT 0,
      minted_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_samint_creator ON social_algo_mints(creator_id, minted_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_federation_outbox_status (
      outbox_id     INTEGER PRIMARY KEY,                    -- FK into the existing migration-198 federation_outbox table
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','sent','failed','skipped')),
      attempts      INTEGER NOT NULL DEFAULT 0,
      last_error    TEXT,
      next_retry_at INTEGER,
      processed_at  INTEGER,
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_sfos_status ON social_federation_outbox_status(status, next_retry_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS social_federation_outbox_status;
    DROP TABLE IF EXISTS social_algo_mints;
    DROP TABLE IF EXISTS social_post_mints;
  `);
}
