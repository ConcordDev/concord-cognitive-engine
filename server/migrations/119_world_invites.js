// Migration 119 — World invites.
//
// Player-to-player invitations to specific worlds. The recipient sees
// these in the World Terminal (/lenses/world/travel) and can accept
// (which routes them to the world) or decline.
//
// Schema:
//   - id PK so individual invites can be addressed for accept/decline.
//   - from_user_id + to_user_id reference users. No FK because users
//     can be soft-deleted — orphaned invites are cleaned up by the
//     world-invite GC sweep (status='expired').
//   - world_id is the destination; FK to worlds(id).
//   - status: 'pending' (default), 'accepted', 'declined', 'expired'.
//   - expires_at: TTL — invites auto-expire after 7d default.
//
// Indexes:
//   - idx_world_invites_to_pending: list-pending query path
//     (`SELECT * WHERE to_user_id=? AND status='pending'`)
//   - idx_world_invites_status_expires: GC sweep path

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_invites (
      id            TEXT PRIMARY KEY,
      from_user_id  TEXT NOT NULL,
      to_user_id    TEXT NOT NULL,
      world_id      TEXT NOT NULL,
      world_name    TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','declined','expired')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at    TEXT NOT NULL DEFAULT (datetime('now', '+7 days')),
      responded_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_world_invites_to_pending
      ON world_invites (to_user_id, status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_world_invites_status_expires
      ON world_invites (status, expires_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_world_invites_status_expires;
    DROP INDEX IF EXISTS idx_world_invites_to_pending;
    DROP TABLE IF EXISTS world_invites;
  `);
}
