// server/migrations/206_romance.js
//
// Phase II Wave 25 — player romance / family / dynasty loops.
//
// Mig 182 added NPC marriages and culture; this wave adds the
// player-side loops: courtship affinity, marriages, pregnancies,
// children, bloodline buffs.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_courtship (
      player_user_id    TEXT NOT NULL,
      partner_kind      TEXT NOT NULL CHECK (partner_kind IN ('player','npc')),
      partner_id        TEXT NOT NULL,
      affinity          REAL NOT NULL DEFAULT 0
                          CHECK (affinity >= -1 AND affinity <= 1),
      status            TEXT NOT NULL DEFAULT 'acquainted'
                          CHECK (status IN ('acquainted','courting','engaged','married','widowed','estranged')),
      started_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      last_interaction  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (player_user_id, partner_kind, partner_id)
    );
    CREATE INDEX IF NOT EXISTS idx_courtship_player ON player_courtship (player_user_id, status);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS player_marriages (
      id              TEXT PRIMARY KEY,
      player_user_id  TEXT NOT NULL,
      partner_kind    TEXT NOT NULL CHECK (partner_kind IN ('player','npc')),
      partner_id      TEXT NOT NULL,
      married_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      dissolved_at    INTEGER,
      dissolved_reason TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_player_marriages_active
      ON player_marriages (player_user_id, partner_kind, partner_id)
      WHERE dissolved_at IS NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS player_pregnancies (
      id              TEXT PRIMARY KEY,
      carrier_user_id TEXT NOT NULL,
      partner_kind    TEXT NOT NULL CHECK (partner_kind IN ('player','npc')),
      partner_id      TEXT NOT NULL,
      conceived_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      due_at          INTEGER NOT NULL,
      born_at         INTEGER,
      complications_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_player_pregnancies_active
      ON player_pregnancies (carrier_user_id, born_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS player_children (
      id              TEXT PRIMARY KEY,
      parent_user_id  TEXT NOT NULL,
      other_parent_kind TEXT NOT NULL CHECK (other_parent_kind IN ('player','npc','unknown')),
      other_parent_id TEXT,
      name            TEXT NOT NULL,
      born_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      age_days        INTEGER NOT NULL DEFAULT 0,
      maturity        TEXT NOT NULL DEFAULT 'infant'
                       CHECK (maturity IN ('infant','child','adolescent','adult')),
      inherited_skills_json TEXT NOT NULL DEFAULT '{}',
      personality_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_player_children_parent
      ON player_children (parent_user_id, born_at DESC);
  `);
}

export const description = "Phase II Wave 25 — player romance / marriages / pregnancies / children";
