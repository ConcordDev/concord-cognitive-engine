// server/migrations/198_social_federation.js
//
// Phase 11 (Item 12) — federate the pan-social substrate.
//
// social_posts lives in memory today (server/emergent/social-layer.js),
// so we can't ALTER it. Instead this migration ships the outbox /
// inbox tables that make federation a durable, retryable substrate
// concern — survives restarts, survives instance peer outages.
//
// Three tables:
//
//   federation_outbox — one row per pending outbound activity.
//                       `target_inbox_url` is the remote actor's
//                       inbox URL discovered via webfinger; the
//                       heartbeat pump POSTs the activity_json and
//                       bumps status / attempts / last_attempted_at
//                       until it lands. Capped retries.
//
//   federation_inbox  — every inbound activity from a remote peer,
//                       deduped by ap_activity_id. processed = 0
//                       means the local social-layer hasn't ingested
//                       it yet.
//
//   federation_peer_actors — light cache of remote actor metadata
//                            (display name, avatar, inbox URL) so
//                            the UI can render "from
//                            kai@mastodon.example" chips without
//                            a webfinger round-trip every time.
//
// Honest discipline: federation is OPT-IN per post via the
// visibility toggle (defaults 'local'). No post leaves the instance
// unless the user explicitly chose 'followers' or 'public'.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS federation_outbox (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      home_user_id        TEXT NOT NULL,
      ap_activity_id      TEXT NOT NULL,
      activity_type       TEXT NOT NULL,
      activity_json       TEXT NOT NULL,
      target_inbox_url    TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_flight','delivered','failed','abandoned')),
      attempts            INTEGER NOT NULL DEFAULT 0,
      last_attempted_at   INTEGER,
      last_error          TEXT,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_federation_outbox_status ON federation_outbox(status, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_federation_outbox_actor  ON federation_outbox(home_user_id, created_at)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS federation_inbox (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ap_activity_id  TEXT NOT NULL UNIQUE,
      source_actor    TEXT NOT NULL,
      activity_type   TEXT NOT NULL,
      activity_json   TEXT NOT NULL,
      processed       INTEGER NOT NULL DEFAULT 0,
      received_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      processed_at    INTEGER
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_federation_inbox_unprocessed ON federation_inbox(processed, received_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_federation_inbox_actor       ON federation_inbox(source_actor, received_at)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS federation_peer_actors (
      actor_id       TEXT PRIMARY KEY,
      handle         TEXT,
      display_name   TEXT,
      avatar_url     TEXT,
      inbox_url      TEXT,
      instance_url   TEXT,
      first_seen_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen_at   INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_federation_peer_actors_handle ON federation_peer_actors(handle)`);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_federation_peer_actors_handle`);
  db.exec(`DROP TABLE IF EXISTS federation_peer_actors`);
  db.exec(`DROP INDEX IF EXISTS idx_federation_inbox_actor`);
  db.exec(`DROP INDEX IF EXISTS idx_federation_inbox_unprocessed`);
  db.exec(`DROP TABLE IF EXISTS federation_inbox`);
  db.exec(`DROP INDEX IF EXISTS idx_federation_outbox_actor`);
  db.exec(`DROP INDEX IF EXISTS idx_federation_outbox_status`);
  db.exec(`DROP TABLE IF EXISTS federation_outbox`);
}
