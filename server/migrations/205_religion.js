// server/migrations/205_religion.js
//
// Phase II Wave 24 — religion / faith dynamics.
//
// Net-new system. Migration 182 added actor_culture (with faith_id
// column) as a label only; this wave gives faiths actual gameplay
// behavior: founding, worship, conversion, fervor progression,
// heresy + inquisition.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS faiths (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      doctrine_json   TEXT NOT NULL DEFAULT '{}',
      founder_kind    TEXT NOT NULL CHECK (founder_kind IN ('player','npc','authored')),
      founder_id      TEXT,
      tenet_count     INTEGER NOT NULL DEFAULT 0
                       CHECK (tenet_count >= 0 AND tenet_count <= 32),
      total_worshippers INTEGER NOT NULL DEFAULT 0,
      founded_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      schism_parent_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_faiths_founder ON faiths (founder_kind, founder_id);
    CREATE INDEX IF NOT EXISTS idx_faiths_name ON faiths (name);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS worshippers (
      faith_id        TEXT NOT NULL,
      actor_kind      TEXT NOT NULL CHECK (actor_kind IN ('player','npc')),
      actor_id        TEXT NOT NULL,
      faith_strength  REAL NOT NULL DEFAULT 0.1
                       CHECK (faith_strength >= 0 AND faith_strength <= 1),
      joined_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      left_at         INTEGER,
      role            TEXT NOT NULL DEFAULT 'lay'
                       CHECK (role IN ('lay','novice','priest','prophet','heretic')),
      PRIMARY KEY (faith_id, actor_kind, actor_id)
    );
    CREATE INDEX IF NOT EXISTS idx_worshippers_actor ON worshippers (actor_kind, actor_id);
    CREATE INDEX IF NOT EXISTS idx_worshippers_active ON worshippers (faith_id, left_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS faith_events (
      id              TEXT PRIMARY KEY,
      faith_id        TEXT NOT NULL,
      actor_kind      TEXT NOT NULL,
      actor_id        TEXT NOT NULL,
      event_kind      TEXT NOT NULL CHECK (event_kind IN (
                        'prayer','sermon','conversion','excommunication',
                        'heresy_accusation','crusade','schism','founding'
                      )),
      target_actor_id TEXT,
      payload_json    TEXT NOT NULL DEFAULT '{}',
      ts              INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_faith_events_faith_ts ON faith_events (faith_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_faith_events_actor ON faith_events (actor_kind, actor_id, ts DESC);
  `);
}

export const description = "Phase II Wave 24 — religion / faiths / worshippers / faith_events";
