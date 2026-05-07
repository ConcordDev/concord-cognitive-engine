// server/migrations/103_tournaments.js
//
// Tournament toolkit. Player-organized competitive PvP scenes form
// themselves around control-scheme restrictions ("Karate-only," "Boxing
// vs Boxing," "Magic-Channel mirror match") and the system records the
// brackets, escrows the prize pool, mints chronicle DTUs.
//
// Tables:
//   tournaments           — top-level tournament record + rules + escrow
//   tournament_entrants   — registered fighter list
//   tournament_brackets   — bracket node tree (single-elim default)
//
// Append-only per CLAUDE.md migration invariant.
//
// Rule schema (rules_json):
//   {
//     allowed_schemes:    ['boxer'],          // control schemes admitted
//     procedural_combos:  false,              // disable evolved combos
//     max_tier:           5,                  // cap evolved combo tier
//     hp_cap:             100,                // override HP
//     time_limit_s:       180,                // per-bout time limit
//     best_of:            3,                  // rounds to win
//     stake_cc:           0,                  // entry fee escrowed
//   }

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      organizer_id    TEXT NOT NULL,
      world_id        TEXT NOT NULL DEFAULT 'concordia-hub',
      district_id     TEXT,
      status          TEXT NOT NULL DEFAULT 'open',
        -- open | in_progress | completed | cancelled
      bracket_kind    TEXT NOT NULL DEFAULT 'single_elim',
        -- single_elim | round_robin (single_elim is default v1)
      rules_json      TEXT NOT NULL DEFAULT '{}',
      prize_pool_cc   INTEGER NOT NULL DEFAULT 0,
      escrow_user_id  TEXT,
        -- where prize CC is held (null until first deposit)
      max_entrants    INTEGER NOT NULL DEFAULT 16,
      winner_id       TEXT,
      chronicle_dtu_id TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at      INTEGER,
      completed_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status, world_id);
    CREATE INDEX IF NOT EXISTS idx_tournaments_organizer ON tournaments(organizer_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tournament_entrants (
      id              TEXT PRIMARY KEY,
      tournament_id   TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      seed            INTEGER NOT NULL DEFAULT 0,
      stake_paid      INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'registered',
        -- registered | active | eliminated | withdrew
      eliminated_at_round INTEGER,
      registered_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(tournament_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tournament_entrants_tournament ON tournament_entrants(tournament_id, status);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tournament_brackets (
      id              TEXT PRIMARY KEY,
      tournament_id   TEXT NOT NULL,
      round_number    INTEGER NOT NULL,
      slot_index      INTEGER NOT NULL,
      fighter_a_id    TEXT,
      fighter_b_id    TEXT,
      winner_id       TEXT,
      match_id        TEXT,
        -- references training_matches.id when bout starts
      chronicle_dtu_id TEXT,
        -- per-bout chronicle DTU
      status          TEXT NOT NULL DEFAULT 'pending',
        -- pending | in_progress | complete | bye
      started_at      INTEGER,
      completed_at    INTEGER,
      UNIQUE(tournament_id, round_number, slot_index)
    );
    CREATE INDEX IF NOT EXISTS idx_tournament_brackets_tournament
      ON tournament_brackets(tournament_id, round_number, slot_index);
  `);

  // Extend training_matches with rule-set + tournament reference. SQLite
  // ALTER TABLE only adds columns; both are optional with safe defaults
  // so existing rows are unaffected.
  const cols = db.prepare(`PRAGMA table_info(training_matches)`).all().map((r) => r.name);
  if (!cols.includes("rules_json")) {
    db.exec(`ALTER TABLE training_matches ADD COLUMN rules_json TEXT NOT NULL DEFAULT '{}'`);
  }
  if (!cols.includes("tournament_bracket_id")) {
    db.exec(`ALTER TABLE training_matches ADD COLUMN tournament_bracket_id TEXT`);
  }
  if (!cols.includes("world_id")) {
    db.exec(`ALTER TABLE training_matches ADD COLUMN world_id TEXT NOT NULL DEFAULT 'concordia-hub'`);
  }
}

export function down(_db) {
  // SQLite < 3.35 — leave tables in place. A follow-up migration can
  // drop them if the toolkit is ever retired.
}
