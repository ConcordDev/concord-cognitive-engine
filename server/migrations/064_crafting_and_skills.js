// server/migrations/064_crafting_and_skills.js
// Crafting system: player skill levels, world market, governance directives, building rooms.

export function up(db) {
  // ── Per-player per-world-type skill levels ─────────────────────────────────
  // Earned through use in the world, not through DTUs.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS player_skill_levels (
      id                TEXT    PRIMARY KEY,
      user_id           TEXT    NOT NULL,
      skill_type        TEXT    NOT NULL,
      native_world_type TEXT    NOT NULL,
      level             INTEGER NOT NULL DEFAULT 0,
      xp                INTEGER NOT NULL DEFAULT 0,
      xp_to_next        INTEGER NOT NULL DEFAULT 100,
      last_used_at      INTEGER,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, skill_type, native_world_type)
    )
  `).run();

  db.prepare('CREATE INDEX IF NOT EXISTS idx_skill_levels_user ON player_skill_levels(user_id)').run();

  // ── World supply/demand market ─────────────────────────────────────────────
  db.prepare(`
    CREATE TABLE IF NOT EXISTS world_market (
      id               TEXT    PRIMARY KEY,
      world_id         TEXT    NOT NULL,
      resource_id      TEXT    NOT NULL,
      base_price       INTEGER NOT NULL DEFAULT 10,
      current_price    INTEGER NOT NULL DEFAULT 10,
      supply_count     INTEGER NOT NULL DEFAULT 100,
      demand_count     INTEGER NOT NULL DEFAULT 10,
      transactions_24h INTEGER NOT NULL DEFAULT 0,
      last_updated     INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(world_id, resource_id)
    )
  `).run();

  // ── Emergent/NPC governance directives ────────────────────────────────────
  db.prepare(`
    CREATE TABLE IF NOT EXISTS world_directives (
      id                 TEXT    PRIMARY KEY,
      world_id           TEXT    NOT NULL,
      issuer_id          TEXT    NOT NULL,
      issuer_type        TEXT    NOT NULL DEFAULT 'emergent',
      directive          TEXT    NOT NULL,
      directive_type     TEXT    NOT NULL DEFAULT 'order',
      faction            TEXT,
      status             TEXT    NOT NULL DEFAULT 'active',
      votes_for          INTEGER NOT NULL DEFAULT 0,
      votes_against      INTEGER NOT NULL DEFAULT 0,
      votes_abstain      INTEGER NOT NULL DEFAULT 0,
      quorum_required    INTEGER NOT NULL DEFAULT 3,
      rejection_threshold REAL   NOT NULL DEFAULT 0.3,
      expires_at         INTEGER,
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at        INTEGER
    )
  `).run();

  db.prepare('CREATE INDEX IF NOT EXISTS idx_directives_world ON world_directives(world_id, status)').run();

  // ── NPC votes on directives ────────────────────────────────────────────────
  db.prepare(`
    CREATE TABLE IF NOT EXISTS directive_votes (
      id         TEXT    PRIMARY KEY,
      directive_id TEXT  NOT NULL,
      voter_id   TEXT    NOT NULL,
      voter_type TEXT    NOT NULL DEFAULT 'npc',
      vote       TEXT    NOT NULL,
      reason     TEXT,
      voted_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(directive_id, voter_id)
    )
  `).run();

  // ── Building rooms (interior system) ──────────────────────────────────────
  db.prepare(`
    CREATE TABLE IF NOT EXISTS building_rooms (
      id          TEXT    PRIMARY KEY,
      building_id TEXT    NOT NULL,
      world_id    TEXT    NOT NULL,
      room_type   TEXT    NOT NULL DEFAULT 'generic',
      name        TEXT,
      width       REAL    NOT NULL DEFAULT 6,
      depth       REAL    NOT NULL DEFAULT 6,
      height      REAL    NOT NULL DEFAULT 3,
      x_offset    REAL    NOT NULL DEFAULT 0,
      z_offset    REAL    NOT NULL DEFAULT 0,
      floor       INTEGER NOT NULL DEFAULT 1,
      capacity    INTEGER NOT NULL DEFAULT 4,
      owner_id    TEXT,
      is_public   INTEGER NOT NULL DEFAULT 1,
      furniture   TEXT    DEFAULT '[]',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `).run();

  db.prepare('CREATE INDEX IF NOT EXISTS idx_rooms_building ON building_rooms(building_id)').run();
}

export function down(db) {
  db.prepare('DROP TABLE IF EXISTS building_rooms').run();
  db.prepare('DROP TABLE IF EXISTS directive_votes').run();
  db.prepare('DROP TABLE IF EXISTS world_directives').run();
  db.prepare('DROP TABLE IF EXISTS world_market').run();
  db.prepare('DROP TABLE IF EXISTS player_skill_levels').run();
}
