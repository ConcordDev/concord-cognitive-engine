// server/migrations/229_council_dtu_votes.js
//
// Smoking-gun cleanup — STATE.councilVotes was an in-memory Map keyed
// by dtuId, used by the council.vote / council.tally / council.userStats
// macros at server.js:33982 / 34016 / 34027 / 49301 / 49319 / 49343.
// Every restart wiped governance votes.
//
// The existing migration-183 council_votes table is keyed by
// (petition_id, member_id) for council PETITION voting — a different
// surface. This migration adds a dedicated council_dtu_votes table
// matching the macro's actual shape: one vote per (dtuId, voterId)
// with persona + reason + weight.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS council_dtu_votes (
      id          TEXT PRIMARY KEY,
      dtu_id      TEXT NOT NULL,
      voter_id    TEXT NOT NULL,                              -- ctx.actor.id || ctx.actor.odId || persona || 'anonymous'
      vote        TEXT NOT NULL CHECK (vote IN ('approve','reject','abstain')),
      persona     TEXT NOT NULL DEFAULT 'anonymous',
      reason      TEXT NOT NULL DEFAULT '',
      weight      REAL NOT NULL DEFAULT 1.0,
      cast_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(dtu_id, voter_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cdv_dtu   ON council_dtu_votes(dtu_id, cast_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cdv_voter ON council_dtu_votes(voter_id, cast_at DESC);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS council_dtu_votes;`);
}
