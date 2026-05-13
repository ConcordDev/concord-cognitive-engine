// server/migrations/181_aging_dynasty.js
//
// Concordia Phase 12 — generational aging + player dynasty.
//
// Three tables:
//
//   npc_ages — NPC age tracking (birth_concordia_day, expected_death_concordia_day).
//     The aging cycle heartbeat reads expected_death_concordia_day and
//     fires onNpcDeath when the current Concordia day passes it.
//
//   player_dynasties — house identity that survives heir takeover.
//     founder_user_id, house_name, renown 0..1000, current_head_user_id.
//
//   player_heir_takeovers — append-only ledger of player avatar heirs.
//     When the active avatar dies, an heir option is surfaced; on
//     accept, the new avatar inherits the dynasty.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_ages (
      npc_id                       TEXT    PRIMARY KEY,
      birth_concordia_day          INTEGER NOT NULL,
      expected_death_concordia_day INTEGER,
      archetype                    TEXT,
      established_at               INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_npc_ages_death ON npc_ages(expected_death_concordia_day)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS player_dynasties (
      id                   TEXT    PRIMARY KEY,
      founder_user_id      TEXT    NOT NULL,
      current_head_user_id TEXT    NOT NULL,
      house_name           TEXT    NOT NULL,
      renown               INTEGER NOT NULL DEFAULT 0
                                    CHECK (renown BETWEEN 0 AND 1000),
      founded_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      generations          INTEGER NOT NULL DEFAULT 1
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dynasty_head ON player_dynasties(current_head_user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dynasty_founder ON player_dynasties(founder_user_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS player_heir_takeovers (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      dynasty_id          TEXT    NOT NULL,
      predecessor_user_id TEXT    NOT NULL,
      heir_user_id        TEXT    NOT NULL,
      cause               TEXT,
      taken_at            INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_heir_dynasty ON player_heir_takeovers(dynasty_id)`);
}

export function down(_db) {
  // Forward-only — dynasty + aging history are permanent.
}
