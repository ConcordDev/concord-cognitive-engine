// server/migrations/105_kingdoms.js
//
// Kingdom system — Crusader Kings × 3D × MMO.
//
// Every world can host kingdoms. NPCs hold them by default; players can
// found new ones, contest existing ones, or join as residents. Rulers
// enact decrees that — IF the decree aligns with the world's storyline +
// faction policy state — activate as refusal-field gates on visitors
// inside the kingdom's region. Misaligned decrees stack as "tension"
// that other players can exploit (raid, subversion, annexation).
//
// Append-only per CLAUDE.md migration invariant.

export function up(db) {
  // Top-level kingdoms table. region_polygon_json is a GeoJSON-style
  // [[x, z], [x, z], …] array of world coordinates forming the
  // kingdom's enclosed region. Concave polygons supported via
  // ray-casting point-in-polygon (lib/kingdom.js).
  db.exec(`
    CREATE TABLE IF NOT EXISTS kingdoms (
      id                    TEXT PRIMARY KEY,
      world_id              TEXT NOT NULL,
      name                  TEXT NOT NULL,
      region_polygon_json   TEXT NOT NULL,
      ruler_user_id         TEXT,
      ruler_faction_id      TEXT,
      claim_strength        REAL NOT NULL DEFAULT 50.0,
      founded_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      current_storyline_id  TEXT,
      hq_district_id        TEXT,
      UNIQUE(world_id, name)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kingdoms_world  ON kingdoms(world_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kingdoms_ruler  ON kingdoms(ruler_user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kingdoms_faction ON kingdoms(ruler_faction_id)`);

  // Decrees enacted by the ruler. alignment_score is the coherence-check
  // verdict at the moment of enactment. A decree with score >= 0.6
  // gets a refusal_field_id pointing to an applied refusal-field; a
  // decree with score 0.3..0.6 activates as "tension" (no refusal field
  // but visible to other players); below 0.3 fails.
  db.exec(`
    CREATE TABLE IF NOT EXISTS kingdom_decrees (
      id                  TEXT PRIMARY KEY,
      kingdom_id          TEXT NOT NULL,
      decree_kind         TEXT NOT NULL,
      parameters_json     TEXT NOT NULL DEFAULT '{}',
      alignment_score     REAL NOT NULL,
      activation_state    TEXT NOT NULL DEFAULT 'pending',
        -- 'pending' | 'enforced' | 'tension' | 'failed' | 'expired'
      activated_at        INTEGER,
      expires_at          INTEGER,
      refusal_field_id    TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kingdom_decrees_kingdom ON kingdom_decrees(kingdom_id, activation_state)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kingdom_decrees_state   ON kingdom_decrees(activation_state, expires_at)`);

  // Contest state — siege / subversion / annexation in progress.
  db.exec(`
    CREATE TABLE IF NOT EXISTS kingdom_claims (
      id                   TEXT PRIMARY KEY,
      kingdom_id           TEXT NOT NULL,
      claimant_user_id     TEXT,
      claimant_faction_id  TEXT,
      contest_kind         TEXT NOT NULL,
        -- 'siege' | 'subversion' | 'annexation'
      contest_started_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      contest_strength     REAL NOT NULL DEFAULT 0.0,
      resolution_state     TEXT NOT NULL DEFAULT 'active',
        -- 'active' | 'resolved' | 'aborted'
      resolved_at          INTEGER,
      outcome              TEXT
        -- 'overthrew' | 'repelled' | 'aborted'
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kingdom_claims_kingdom ON kingdom_claims(kingdom_id, resolution_state)`);

  // Resident registry — who's joined the kingdom (separate from being
  // physically inside the polygon; residents get role-based perks).
  db.exec(`
    CREATE TABLE IF NOT EXISTS kingdom_residents (
      kingdom_id   TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'citizen',
        -- 'ruler' | 'noble' | 'guard' | 'citizen' | 'visitor'
      joined_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (kingdom_id, user_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kingdom_residents_user ON kingdom_residents(user_id)`);
}

export function down(_db) {
  // SQLite — leave tables on rollback.
}
