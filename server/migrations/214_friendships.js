// server/migrations/214_friendships.js
//
// Friendship graph — bidirectional, accept-required.
//
// Schema:
//   id            — UUID, addressable for accept/decline.
//   requester_id  — user who sent the request.
//   addressee_id  — user the request was sent to.
//   status        — pending | accepted | declined | blocked.
//   created_at, responded_at.
//
// Indexes:
//   - idx_friendships_pair_unique — prevents duplicate friend requests
//     (sorted pair so request A→B and B→A collapse).
//   - idx_friendships_requester  — "my outgoing requests" query path.
//   - idx_friendships_addressee  — "my pending invites" query path.
//
// Symmetric query helper lives in lib/friendships.js — accepts either
// (a, b) ordering and finds the row.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS friendships (
      id            TEXT PRIMARY KEY,
      requester_id  TEXT NOT NULL,
      addressee_id  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','declined','blocked')),
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      responded_at  INTEGER,
      CHECK (requester_id != addressee_id)
    );

    -- Sorted-pair uniqueness: the same two users can have at most one
    -- friendship row. Lower id always goes first.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_pair_unique
      ON friendships (
        MIN(requester_id, addressee_id),
        MAX(requester_id, addressee_id)
      );

    CREATE INDEX IF NOT EXISTS idx_friendships_requester
      ON friendships (requester_id, status);
    CREATE INDEX IF NOT EXISTS idx_friendships_addressee
      ON friendships (addressee_id, status);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_friendships_addressee;
    DROP INDEX IF EXISTS idx_friendships_requester;
    DROP INDEX IF EXISTS idx_friendships_pair_unique;
    DROP TABLE IF EXISTS friendships;
  `);
}
