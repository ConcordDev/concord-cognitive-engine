// Migration 158 — Sprint C / Track D: Procedural kingdoms + decrees + citizens.
//
// Layered on top of factions: every authored faction with territory becomes
// a kingdom. NPC ruler runs decrees deterministically; player can take over
// via conquest / inheritance / election (Track D3) and run their own rule.
// Track D4 reads citizen loyalty + scheme risk to compute rebellions.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS realms (
      id                    TEXT    PRIMARY KEY,
      name                  TEXT    NOT NULL,
      world_id              TEXT    NOT NULL,
      capital_settlement_id TEXT,
      faction_id            TEXT,
      ruler_kind            TEXT    NOT NULL DEFAULT 'npc'
                                    CHECK (ruler_kind IN ('npc', 'player', 'interregnum')),
      ruler_id              TEXT,
      legitimacy            INTEGER NOT NULL DEFAULT 60
                                    CHECK (legitimacy BETWEEN 0 AND 100),
      treasury              INTEGER NOT NULL DEFAULT 1000,
      tax_rate              REAL    NOT NULL DEFAULT 0.10
                                    CHECK (tax_rate BETWEEN 0.0 AND 0.5),
      founded_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      predecessor_kingdom_id TEXT,
      next_decree_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_kingdom_world  ON realms(world_id);
    CREATE INDEX IF NOT EXISTS idx_kingdom_ruler  ON realms(ruler_kind, ruler_id);
    CREATE INDEX IF NOT EXISTS idx_kingdom_next   ON realms(next_decree_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS realm_territories (
      kingdom_id TEXT NOT NULL,
      region_id  TEXT NOT NULL,
      added_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (kingdom_id, region_id)
    );
    CREATE INDEX IF NOT EXISTS idx_terr_region ON realm_territories(region_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS realm_decrees (
      id                TEXT    PRIMARY KEY,
      kingdom_id        TEXT    NOT NULL,
      kind              TEXT    NOT NULL CHECK (kind IN
                                ('tax_change', 'conscription', 'trade_embargo',
                                 'recipe_grant', 'pardon', 'exile',
                                 'construction', 'festival')),
      body_json         TEXT,
      issued_by_kind    TEXT    NOT NULL CHECK (issued_by_kind IN ('npc', 'player', 'system')),
      issued_by_id      TEXT,
      issued_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at        INTEGER,
      effect_state      TEXT    NOT NULL DEFAULT 'pending'
                                CHECK (effect_state IN ('pending', 'active', 'expired', 'revoked', 'sabotaged')),
      popularity_delta  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_decree_kingdom ON realm_decrees(kingdom_id, effect_state);
    CREATE INDEX IF NOT EXISTS idx_decree_expiry  ON realm_decrees(expires_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS realm_citizens (
      npc_id          TEXT    NOT NULL,
      kingdom_id      TEXT    NOT NULL,
      loyalty         INTEGER NOT NULL DEFAULT 50
                              CHECK (loyalty BETWEEN 0 AND 100),
      last_review_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (npc_id, kingdom_id)
    );
    CREATE INDEX IF NOT EXISTS idx_citizen_kingdom ON realm_citizens(kingdom_id, loyalty);
  `);
}

export function down(_db) {
  // Forward-only.
}
