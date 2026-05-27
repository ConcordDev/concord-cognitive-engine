// server/migrations/207_politics_elections.js
//
// Phase II Wave 22 — politics / elections beyond council.
//
// The existing council-engine (mig 159, faction_strategy) handles
// realm-scoped voting between NPC council members. This wave adds
// world-scoped elections that let *players* declare candidacy,
// campaign, debate, and vote.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS election_cycles (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      office_kind     TEXT NOT NULL CHECK (office_kind IN (
                        'mayor','council_seat','faction_leader','realm_speaker','tribune'
                      )),
      seat_label      TEXT NOT NULL,
      phase           TEXT NOT NULL DEFAULT 'filing'
                        CHECK (phase IN ('filing','primary','debates','general','certification','term')),
      filing_open_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      voting_open_at  INTEGER,
      voting_close_at INTEGER,
      certified_at    INTEGER,
      term_ends_at    INTEGER,
      winner_candidate_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_election_cycles_world_phase
      ON election_cycles (world_id, phase);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS election_candidates (
      id              TEXT PRIMARY KEY,
      cycle_id        TEXT NOT NULL,
      candidate_kind  TEXT NOT NULL CHECK (candidate_kind IN ('player','npc')),
      candidate_id    TEXT NOT NULL,
      platform_json   TEXT NOT NULL DEFAULT '{}',
      filed_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      withdrawn_at    INTEGER,
      total_donations_cents INTEGER NOT NULL DEFAULT 0,
      total_rallies   INTEGER NOT NULL DEFAULT 0,
      total_debates   INTEGER NOT NULL DEFAULT 0,
      total_votes     INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_election_candidates_cycle_actor
      ON election_candidates (cycle_id, candidate_kind, candidate_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS election_ballots (
      id              TEXT PRIMARY KEY,
      cycle_id        TEXT NOT NULL,
      voter_kind      TEXT NOT NULL CHECK (voter_kind IN ('player','npc')),
      voter_id        TEXT NOT NULL,
      candidate_id    TEXT NOT NULL,
      cast_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE (cycle_id, voter_kind, voter_id)
    );
    CREATE INDEX IF NOT EXISTS idx_election_ballots_cycle ON election_ballots (cycle_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_events (
      id              TEXT PRIMARY KEY,
      candidate_id    TEXT NOT NULL,
      event_kind      TEXT NOT NULL CHECK (event_kind IN ('rally','debate','town_hall','donation')),
      payload_json    TEXT NOT NULL DEFAULT '{}',
      occurred_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      affinity_delta  REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_events_candidate
      ON campaign_events (candidate_id, occurred_at DESC);
  `);
}

export const description = "Phase II Wave 22 — politics / elections (cycles, candidates, ballots, campaign_events)";
