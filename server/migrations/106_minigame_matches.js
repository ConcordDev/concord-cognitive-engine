// server/migrations/106_minigame_matches.js
//
// Generic minigame match table — supports basketball, racing, future
// sports. Each minigame engine writes its own kind-specific scores_json
// shape but the lifecycle (status, started_at, ended_at, chronicle) is
// shared.
//
// Append-only per CLAUDE.md migration invariant.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS minigame_matches (
      id                TEXT PRIMARY KEY,
      kind              TEXT NOT NULL,
        -- 'basketball' | 'racing' | <future sport>
      world_id          TEXT NOT NULL DEFAULT 'concordia-hub',
      district_id       TEXT,
      players_json      TEXT NOT NULL DEFAULT '[]',
      scores_json       TEXT NOT NULL DEFAULT '{}',
      status            TEXT NOT NULL DEFAULT 'active',
        -- 'active' | 'ended' | 'cancelled'
      started_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at          INTEGER,
      winner_id         TEXT,
      chronicle_dtu_id  TEXT,
      meta_json         TEXT NOT NULL DEFAULT '{}'
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_minigames_kind_status ON minigame_matches(kind, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_minigames_world      ON minigame_matches(world_id, status)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS minigame_events (
      id           TEXT PRIMARY KEY,
      match_id     TEXT NOT NULL,
      actor_id     TEXT NOT NULL,
      event_kind   TEXT NOT NULL,
        -- basketball: 'shot_made_2' | 'shot_made_3' | 'shot_missed'
        -- racing:     'checkpoint' | 'lap_complete' | 'crash'
      payload_json TEXT NOT NULL DEFAULT '{}',
      ts           INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_minigame_events_match ON minigame_events(match_id, ts)`);
}

export function down(_db) { /* sqlite — leave tables on rollback */ }
