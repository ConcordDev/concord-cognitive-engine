// server/migrations/211_sports_leagues.js
//
// Phase II Wave 17 — sports leagues persistent loop.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sports_leagues (
      id          TEXT PRIMARY KEY,
      world_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      sport_kind  TEXT NOT NULL CHECK (sport_kind IN (
                    'basketball','soccer','brawling','racing','esports','baseball'
                  )),
      season_num  INTEGER NOT NULL DEFAULT 1,
      started_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      next_match_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sports_leagues_world ON sports_leagues (world_id, sport_kind);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sports_teams (
      id          TEXT PRIMARY KEY,
      league_id   TEXT NOT NULL,
      name        TEXT NOT NULL,
      wins        INTEGER NOT NULL DEFAULT 0,
      losses      INTEGER NOT NULL DEFAULT 0,
      draws       INTEGER NOT NULL DEFAULT 0,
      power_score REAL NOT NULL DEFAULT 50
                   CHECK (power_score >= 0 AND power_score <= 100)
    );
    CREATE INDEX IF NOT EXISTS idx_sports_teams_league ON sports_teams (league_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sports_rosters (
      team_id      TEXT NOT NULL,
      member_kind  TEXT NOT NULL CHECK (member_kind IN ('player','npc')),
      member_id    TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'roster'
                    CHECK (role IN ('roster','starter','captain','coach','manager')),
      joined_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      left_at      INTEGER,
      PRIMARY KEY (team_id, member_kind, member_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sports_rosters_member ON sports_rosters (member_kind, member_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sports_matches (
      id            TEXT PRIMARY KEY,
      league_id     TEXT NOT NULL,
      home_team_id  TEXT NOT NULL,
      away_team_id  TEXT NOT NULL,
      home_score    INTEGER,
      away_score    INTEGER,
      scheduled_at  INTEGER NOT NULL,
      played_at     INTEGER,
      status        TEXT NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled','live','finished','cancelled'))
    );
    CREATE INDEX IF NOT EXISTS idx_sports_matches_league_sched ON sports_matches (league_id, scheduled_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sports_careers (
      id             TEXT PRIMARY KEY,
      player_user_id TEXT NOT NULL,
      sport_kind     TEXT NOT NULL,
      stage          TEXT NOT NULL DEFAULT 'amateur'
                      CHECK (stage IN ('amateur','semi_pro','pro','all_star','legend')),
      tryouts_attempted INTEGER NOT NULL DEFAULT 0,
      tryouts_passed    INTEGER NOT NULL DEFAULT 0,
      matches_played    INTEGER NOT NULL DEFAULT 0,
      total_score       INTEGER NOT NULL DEFAULT 0,
      mvp_awards        INTEGER NOT NULL DEFAULT 0,
      retired_at        INTEGER,
      started_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sports_careers_player_sport
      ON sports_careers (player_user_id, sport_kind);
  `);
}

export const description = "Phase II Wave 17 — sports: leagues, teams, rosters, matches, careers";
