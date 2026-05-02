// server/migrations/063_world_environment.js
// Interactive world environment: resource nodes (ore veins, trees, herbs, crystals, fuel)
// and world buildings (seed city + player-placed structures).

export function up(db) {
  // ── Resource nodes ─────────────────────────────────────────────────────────
  // Every world has resource nodes scattered across the terrain.
  // Players AND NPCs gather from these; nodes deplete and respawn.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS world_resource_nodes (
      id                 TEXT    PRIMARY KEY,
      world_id           TEXT    NOT NULL,
      node_type          TEXT    NOT NULL,        -- 'ore_vein'|'tree'|'herb'|'stone'|'crystal'|'fuel'|'spring'
      resource_id        TEXT    NOT NULL,        -- 'iron-ore'|'wood'|'coal'|'herbs'|'crystal'|etc.
      resource_name      TEXT    NOT NULL,        -- human-readable display name
      biome              TEXT    DEFAULT 'plains',-- 'forest'|'mountain'|'plains'|'highland'|'water'
      x                  REAL    NOT NULL,        -- world X position (0–2000)
      y                  REAL    NOT NULL,        -- surface elevation (metres)
      z                  REAL    NOT NULL,        -- world Z position (0–2000)
      depth              REAL    DEFAULT 0,       -- 0 = surface; >0 = underground metres
      quantity_remaining INTEGER NOT NULL DEFAULT 100,
      max_quantity       INTEGER NOT NULL DEFAULT 100,
      quality            TEXT    DEFAULT 'common',-- 'common'|'uncommon'|'rare'|'legendary'
      difficulty         INTEGER DEFAULT 1,       -- 1–10; minimum tool-skill to gather efficiently
      respawn_hours      INTEGER DEFAULT 24,      -- hours until fully replenished after depletion
      respawn_at         INTEGER,                 -- unix timestamp when respawn completes; NULL = not depleted
      is_depleted        INTEGER DEFAULT 0,
      last_gathered_by   TEXT,                    -- user_id or npc_id
      last_gathered_at   INTEGER,
      seeded             INTEGER DEFAULT 0,       -- 1 = placed by world generator (not player)
      created_at         INTEGER DEFAULT (unixepoch())
    )
  `).run();

  db.prepare('CREATE INDEX IF NOT EXISTS idx_rnodes_world   ON world_resource_nodes(world_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_rnodes_pos     ON world_resource_nodes(world_id, x, z)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_rnodes_respawn ON world_resource_nodes(respawn_at) WHERE is_depleted = 1').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_rnodes_depth   ON world_resource_nodes(world_id, depth)').run();

  // ── World buildings ─────────────────────────────────────────────────────────
  // Seed city buildings (is_seed=1) plus any player- or NPC-placed structures.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS world_buildings (
      id            TEXT    PRIMARY KEY,
      world_id      TEXT    NOT NULL,
      building_type TEXT    NOT NULL,       -- 'inn'|'market'|'forge'|'house'|'well'|'tower'|'farm'|'mine'|'dock'|'warehouse'
      name          TEXT,
      x             REAL    NOT NULL,
      y             REAL    NOT NULL,
      z             REAL    NOT NULL,
      rotation      REAL    DEFAULT 0,
      width         REAL    DEFAULT 10,
      depth         REAL    DEFAULT 10,
      height        REAL    DEFAULT 8,
      material      TEXT    DEFAULT 'stone',-- 'wood'|'stone'|'brick'|'steel'|'thatch'
      floors        INTEGER DEFAULT 1,
      owner_type    TEXT    DEFAULT 'world',-- 'world'|'npc'|'player'
      owner_id      TEXT,
      is_seed       INTEGER DEFAULT 0,      -- 1 = part of the initial seed city
      state         TEXT    DEFAULT 'standing',-- 'standing'|'damaged'|'collapsed'|'construction'
      health_pct    REAL    DEFAULT 1.0,
      npc_occupant  TEXT,                   -- NPC id who lives/works here
      created_at    INTEGER DEFAULT (unixepoch())
    )
  `).run();

  db.prepare('CREATE INDEX IF NOT EXISTS idx_wbuildings_world ON world_buildings(world_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_wbuildings_pos   ON world_buildings(world_id, x, z)').run();

  // ── Player movement state ──────────────────────────────────────────────────
  // Track per-visit position and swim state (written on movement, read by gather).
  const visitCols = db.prepare('PRAGMA table_info(world_visits)').all().map(c => c.name);
  if (!visitCols.includes('is_swimming'))
    db.prepare('ALTER TABLE world_visits ADD COLUMN is_swimming INTEGER DEFAULT 0').run();
  if (!visitCols.includes('swim_depth'))
    db.prepare('ALTER TABLE world_visits ADD COLUMN swim_depth  REAL    DEFAULT 0').run();
  if (!visitCols.includes('last_position'))
    db.prepare('ALTER TABLE world_visits ADD COLUMN last_position TEXT   DEFAULT "{}"').run();
}

export function down(db) {
  db.prepare('DROP TABLE IF EXISTS world_resource_nodes').run();
  db.prepare('DROP TABLE IF EXISTS world_buildings').run();
}
