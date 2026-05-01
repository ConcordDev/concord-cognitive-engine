// server/migrations/061_npc_gear_and_knowledge.js
// NPC self-managed gear, player knowledge registry, bidirectional loot bags

export function up(db) {
  // ── NPC gear state ────────────────────────────────────────────────────────
  const npcCols = db.prepare("PRAGMA table_info(world_npcs)").all().map(c => c.name);
  const addNpcCol = (col, def) => {
    if (!npcCols.includes(col))
      db.prepare(`ALTER TABLE world_npcs ADD COLUMN ${col} ${def}`).run();
  };
  addNpcCol('wealth_sparks',      'REAL    DEFAULT 0');
  addNpcCol('gear_level',         'INTEGER DEFAULT 1');
  addNpcCol('current_activity',   'TEXT    DEFAULT "idle"');
  addNpcCol('activity_resources', 'TEXT    DEFAULT "{}"');

  // Per-slot gear worn by an NPC
  db.prepare(`
    CREATE TABLE IF NOT EXISTS npc_gear (
      id          TEXT PRIMARY KEY,
      npc_id      TEXT NOT NULL REFERENCES world_npcs(id),
      slot        TEXT NOT NULL,          -- weapon | armor | tool | accessory
      item_id     TEXT NOT NULL,
      item_name   TEXT NOT NULL,
      item_type   TEXT NOT NULL,
      gear_level  INTEGER DEFAULT 1,
      stats       TEXT    DEFAULT '{}',   -- JSON: { damage, defense, speed, ... }
      schema_id   TEXT,                  -- blueprint DTU id (null = no recipe)
      equipped    INTEGER DEFAULT 1,
      created_at  INTEGER DEFAULT (unixepoch()),
      UNIQUE(npc_id, slot)
    )
  `).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_npc_gear_npc ON npc_gear(npc_id)`).run();

  // ── Player knowledge registry ─────────────────────────────────────────────
  // Owning an item does NOT grant this — you need to learn the schema separately
  db.prepare(`
    CREATE TABLE IF NOT EXISTS player_knowledge (
      id            TEXT PRIMARY KEY,
      player_id     TEXT NOT NULL,
      schema_id     TEXT NOT NULL,        -- blueprint / recipe DTU id
      item_type     TEXT NOT NULL,
      item_name     TEXT NOT NULL,
      learned_at    INTEGER DEFAULT (unixepoch()),
      source        TEXT NOT NULL,        -- crafted | research | schematic_found | taught_by_npc | achievement
      mastery_level REAL    DEFAULT 0.0, -- 0→1, grows with repeated crafting / use
      times_crafted INTEGER DEFAULT 0,
      UNIQUE(player_id, schema_id)
    )
  `).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_pk_player ON player_knowledge(player_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_pk_schema ON player_knowledge(player_id, schema_id)`).run();

  // ── Loot bags (bidirectional — player or NPC drops, either can claim) ─────
  db.prepare(`
    CREATE TABLE IF NOT EXISTS loot_bags (
      id           TEXT PRIMARY KEY,
      world_id     TEXT NOT NULL,
      position     TEXT NOT NULL,         -- JSON: { x, y, z }
      owner_type   TEXT NOT NULL,         -- player | npc
      owner_id     TEXT NOT NULL,
      killer_type  TEXT NOT NULL,         -- player | npc
      killer_id    TEXT,
      items        TEXT NOT NULL DEFAULT '[]',  -- JSON: [{ id, name, type, quantity, schemaId, gearLevel, stats }]
      claimed_by   TEXT,
      claimed_at   INTEGER,
      expires_at   INTEGER NOT NULL,
      created_at   INTEGER DEFAULT (unixepoch())
    )
  `).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_loot_world  ON loot_bags(world_id, expires_at)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_loot_killer ON loot_bags(killer_id)`).run();

  // ── User gear ceiling singleton ───────────────────────────────────────────
  db.prepare(`
    CREATE TABLE IF NOT EXISTS user_gear_ceiling (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      ceiling_level  INTEGER DEFAULT 1,
      updated_at     INTEGER DEFAULT (unixepoch())
    )
  `).run();
  db.prepare(`INSERT OR IGNORE INTO user_gear_ceiling (id, ceiling_level) VALUES (1, 1)`).run();
}

export function down(db) {
  db.prepare('DROP TABLE IF EXISTS npc_gear').run();
  db.prepare('DROP TABLE IF EXISTS player_knowledge').run();
  db.prepare('DROP TABLE IF EXISTS loot_bags').run();
  db.prepare('DROP TABLE IF EXISTS user_gear_ceiling').run();
}
