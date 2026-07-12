// server/migrations/360_bracket_tournaments.js
//
// Durable persistence for the tournaments lens (domains/tournaments.js,
// Challonge/Battlefy-class bracket platform — multi-format brackets,
// seeding, check-in windows, live match reporting, spectator share links,
// team rosters, prize-payout distribution). Previously the ENTIRE lens
// lived in globalThis._concordSTATE.tournamentsLens.tournaments (a plain
// Map<userId, Tournament[]>) — every tournament, entrant roster, bracket,
// match result, and payout record was lost on server restart. Tracked as
// an open gap in docs/lens-specs/tournaments-capability-map.md and
// docs/WAVE4_INVENTORY.md's `| tournaments |` row.
//
// This does NOT touch the two pre-existing, unrelated tournament
// substrates already in the tree:
//   - migration 103's `tournaments` / `tournament_entrants` /
//     `tournament_brackets` (server/lib/tournament.js, singular —
//     escrowed single-elim toolkit with rule-set enforcement)
//   - `world_tournaments` (server/lib/tournaments.js, plural — "Phase S"
//     real-money per-world tournaments)
// Those names are already taken, and this is a functionally distinct
// system (a generic per-organizer bracket-platform macro surface with no
// wallet integration of its own — prizePoolCc is stored and distributed
// proportionally, never escrowed/debited/credited here). Hence the
// `bracket_*` prefix below to keep the three systems unambiguous.
//
// Schema shape: a single denormalized row per tournament, mirroring the
// in-memory Tournament object field-for-field. Fidelity to the existing
// object shape (rather than a normalized entrants/matches join) was
// chosen deliberately — every macro's response shape is exactly
// `publicView(t)` today, entrant/match objects have per-format-varying
// shapes (single/double-elim vs round-robin vs swiss matches all carry
// different derived fields), and a normalized join would require
// reconstructing bracket-advancement order from relational rows on every
// read. A `*_json TEXT` column per array field (entrants/matches/
// standings/payouts/log) is the established pattern for this elsewhere in
// the tree (see e.g. migration 356 saved_items.tags_json/provenance_json,
// migration 332's ar_* blob shape). Scalar fields used for filtering/
// lookup (status, format, share_slug, user_id) are real columns so
// list/get stay index-backed instead of full-table JSON scans.
//
// Append-only per CLAUDE.md migration invariant.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bracket_tournaments (
      id                 TEXT PRIMARY KEY,
      user_id            TEXT NOT NULL,
        -- the organizer; mirrors the in-memory Map<userId, Tournament[]> key
      title              TEXT NOT NULL,
      game               TEXT,
      format             TEXT NOT NULL DEFAULT 'single_elimination',
        -- single_elimination | double_elimination | round_robin | swiss
      mode               TEXT NOT NULL DEFAULT 'solo',
        -- solo | team
      team_size          INTEGER NOT NULL DEFAULT 1,
      max_entrants       INTEGER NOT NULL DEFAULT 8,
      prize_pool_cc      REAL NOT NULL DEFAULT 0,
        -- distribution-only; this lens holds no wallet and never calls
        -- mintCoins/walletDebit/walletCredit (see domains/tournaments.js)
      payout_split_json  TEXT NOT NULL DEFAULT '[60,25,15]',
      swiss_rounds       INTEGER NOT NULL DEFAULT 5,
      status             TEXT NOT NULL DEFAULT 'upcoming',
        -- upcoming | checkin | in_progress | completed | cancelled
      created_at         INTEGER NOT NULL,
      starts_at          INTEGER,
      checkin_opens_at   INTEGER,
      started_at         INTEGER,
      completed_at       INTEGER,
      share_slug         TEXT NOT NULL,
        -- spectator deep-link lookup key; unique across ALL organizers
      winner_id          TEXT,
      locked             INTEGER NOT NULL DEFAULT 0,
      entrants_json      TEXT NOT NULL DEFAULT '[]',
      matches_json       TEXT NOT NULL DEFAULT '[]',
      standings_json     TEXT NOT NULL DEFAULT '[]',
      payouts_json       TEXT NOT NULL DEFAULT '[]',
      log_json           TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_bracket_tournaments_user
      ON bracket_tournaments(user_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bracket_tournaments_share_slug
      ON bracket_tournaments(share_slug);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_bracket_tournaments_share_slug;
    DROP INDEX IF EXISTS idx_bracket_tournaments_user;
    DROP TABLE IF EXISTS bracket_tournaments;
  `);
}
