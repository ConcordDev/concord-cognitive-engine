// server/migrations/183_council_sessions.js
//
// Concordia Phase 16 — council sessions + petitions + votes.
//
// Per realm, a session opens once per season (4×/year per realm at
// Concordia's 6-season × 7-day calendar). During the session week,
// citizens petition (insert petition row), NPC council members vote
// (insert vote row), and players can attend + lobby (apply opinion
// delta on a council member). Lobby is gated by opinion ≥ 0 with the
// member.
//
// Three tables:
//
//   council_sessions — one row per (realm, season).
//   council_petitions — petitions submitted during the open window.
//   council_votes — votes cast by council members on petitions.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS council_sessions (
      id           TEXT    PRIMARY KEY,
      realm_id     TEXT    NOT NULL,
      season_id    INTEGER NOT NULL,
      year         INTEGER NOT NULL DEFAULT 1,
      status       TEXT    NOT NULL DEFAULT 'open'
                           CHECK (status IN ('scheduled','open','closed','archived')),
      opened_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      closed_at    INTEGER,
      agenda_json  TEXT
    )
  `);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_council_realm_season ON council_sessions(realm_id, season_id, year)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_council_status ON council_sessions(status)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS council_petitions (
      id              TEXT    PRIMARY KEY,
      session_id      TEXT    NOT NULL,
      petitioner_kind TEXT    NOT NULL CHECK (petitioner_kind IN ('player','npc')),
      petitioner_id   TEXT    NOT NULL,
      topic           TEXT    NOT NULL,
      body            TEXT,
      submitted_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      resolution      TEXT    CHECK (resolution IS NULL OR resolution IN ('approved','rejected','tabled'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_petition_session ON council_petitions(session_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS council_votes (
      petition_id TEXT NOT NULL,
      member_id   TEXT NOT NULL,
      vote        TEXT NOT NULL CHECK (vote IN ('aye','nay','abstain')),
      cast_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (petition_id, member_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_council_vote_petition ON council_votes(petition_id)`);
}

export function down(_db) {
  // Forward-only.
}
