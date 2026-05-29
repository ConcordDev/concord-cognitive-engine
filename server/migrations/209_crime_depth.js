// server/migrations/209_crime_depth.js
//
// Phase II Wave 23 — crime depth: gangs, rackets, heists, bounties.
//
// world-crime.js (566 LOC) already handles evidence + lockpick +
// intrusion detection on the NPC-on-NPC side. This wave adds the
// player-initiated layer: heist plans, bounty board, gang territory
// control, racketeering / extortion income.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_crimes (
      id              TEXT PRIMARY KEY,
      perpetrator_user_id TEXT NOT NULL,
      victim_kind     TEXT NOT NULL CHECK (victim_kind IN ('player','npc','building','faction')),
      victim_id       TEXT NOT NULL,
      crime_kind      TEXT NOT NULL CHECK (crime_kind IN (
                        'theft','assault','arson','fraud','smuggling','heist',
                        'racket','bribery','murder','vandalism'
                      )),
      world_id        TEXT,
      severity        REAL NOT NULL DEFAULT 0.5 CHECK (severity >= 0 AND severity <= 1),
      witnessed       INTEGER NOT NULL DEFAULT 0
                       CHECK (witnessed IN (0, 1)),
      bounty_cents    INTEGER NOT NULL DEFAULT 0,
      committed_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at     INTEGER,
      resolution      TEXT CHECK (resolution IS NULL OR resolution IN ('paid','jailed','escaped','pardoned'))
    );
    CREATE INDEX IF NOT EXISTS idx_player_crimes_perp ON player_crimes (perpetrator_user_id, committed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_player_crimes_unresolved ON player_crimes (resolved_at, committed_at DESC) WHERE resolved_at IS NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS gang_territories (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      faction_id      TEXT NOT NULL,
      center_x        REAL NOT NULL,
      center_z        REAL NOT NULL,
      radius_m        REAL NOT NULL CHECK (radius_m > 0 AND radius_m <= 2000),
      control_pct     REAL NOT NULL DEFAULT 50 CHECK (control_pct >= 0 AND control_pct <= 100),
      racket_income_cents INTEGER NOT NULL DEFAULT 0,
      established_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_gang_territories_world ON gang_territories (world_id, faction_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS crime_bounties (
      id              TEXT PRIMARY KEY,
      target_kind     TEXT NOT NULL CHECK (target_kind IN ('player','npc')),
      target_id       TEXT NOT NULL,
      issued_by_kind  TEXT NOT NULL CHECK (issued_by_kind IN ('player','npc','realm','faction')),
      issued_by_id    TEXT NOT NULL,
      amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
      reason          TEXT NOT NULL DEFAULT 'wanted',
      issued_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      claimed_at      INTEGER,
      claimed_by_user_id TEXT,
      cancelled_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_crime_bounties_active ON crime_bounties (target_kind, target_id) WHERE claimed_at IS NULL AND cancelled_at IS NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS heist_plans (
      id              TEXT PRIMARY KEY,
      planner_user_id TEXT NOT NULL,
      target_kind     TEXT NOT NULL CHECK (target_kind IN ('building','faction','npc','vault')),
      target_id       TEXT NOT NULL,
      difficulty      REAL NOT NULL DEFAULT 0.5 CHECK (difficulty >= 0 AND difficulty <= 1),
      reward_cents    INTEGER NOT NULL DEFAULT 0,
      crew_json       TEXT NOT NULL DEFAULT '[]',
      planned_for     INTEGER,
      executed_at     INTEGER,
      success         INTEGER,
      witnesses_count INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_heist_plans_planner ON heist_plans (planner_user_id, created_at DESC);
  `);
}

export const description = "Phase II Wave 23 — crime depth: player_crimes, gang_territories, bounties, heist_plans";
