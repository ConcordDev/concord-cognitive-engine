// server/migrations/066_resource_bars_and_combat.js
// Player resource bars (mana/stamina/health/bio_power/perception), damage events,
// elemental resistances on NPCs, cross-skill prerequisites.

export function up(db) {
  // ── player_resource_bars ──────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_resource_bars (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      world_id        TEXT NOT NULL,
      hp              REAL NOT NULL DEFAULT 100,
      max_hp          REAL NOT NULL DEFAULT 100,
      mana            REAL NOT NULL DEFAULT 100,
      max_mana        REAL NOT NULL DEFAULT 100,
      stamina         REAL NOT NULL DEFAULT 100,
      max_stamina     REAL NOT NULL DEFAULT 100,
      bio_power       REAL NOT NULL DEFAULT 100,
      max_bio_power   REAL NOT NULL DEFAULT 100,
      perception      REAL NOT NULL DEFAULT 100,
      max_perception  REAL NOT NULL DEFAULT 100,
      last_regen_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, world_id)
    );
    CREATE INDEX IF NOT EXISTS idx_res_bars_user ON player_resource_bars(user_id, world_id);
  `);

  // ── damage_events — every combat hit creates a record ────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS damage_events (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      attacker_id     TEXT NOT NULL,
      attacker_type   TEXT NOT NULL DEFAULT 'player',  -- 'player'|'npc'
      target_id       TEXT NOT NULL,
      target_type     TEXT NOT NULL DEFAULT 'npc',
      skill_dtu_id    TEXT,           -- DTU id of the skill/spell used
      item_dtu_id     TEXT,           -- DTU id of weapon/item (if applicable)
      element         TEXT,           -- 'fire'|'ice'|'lightning'|'physical'|'poison'|'bio'|'energy'|'none'
      raw_damage      REAL NOT NULL DEFAULT 0,
      resistance_pct  REAL NOT NULL DEFAULT 0,  -- 0-1 effective resistance applied
      final_damage    REAL NOT NULL DEFAULT 0,
      bar_used        TEXT,           -- 'mana'|'stamina'|'bio_power'|'perception'
      bar_cost        REAL NOT NULL DEFAULT 0,
      status_effects  TEXT DEFAULT '[]',  -- JSON: ['burn','freeze','poison',...]
      kill            INTEGER NOT NULL DEFAULT 0,
      occurred_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_damage_world ON damage_events(world_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_damage_target ON damage_events(target_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_damage_attacker ON damage_events(attacker_id, occurred_at DESC);
  `);

  // ── Elemental resistances on world_npcs ───────────────────────────────────
  try {
    const npcCols = db.prepare('PRAGMA table_info(world_npcs)').all().map(c => c.name);
    const resistCols = [
      ['fire_resistance',      'REAL DEFAULT 0'],
      ['ice_resistance',       'REAL DEFAULT 0'],
      ['lightning_resistance', 'REAL DEFAULT 0'],
      ['physical_resistance',  'REAL DEFAULT 0'],
      ['poison_resistance',    'REAL DEFAULT 0'],
      ['bio_resistance',       'REAL DEFAULT 0'],
      ['energy_resistance',    'REAL DEFAULT 0'],
      ['max_hp',               'REAL DEFAULT 100'],
      ['current_hp',           'REAL DEFAULT 100'],
      ['status_effects',       'TEXT DEFAULT \'[]\''],  // JSON array of active effects
    ];
    for (const [col, def] of resistCols) {
      if (!npcCols.includes(col)) db.exec(`ALTER TABLE world_npcs ADD COLUMN ${col} ${def}`);
    }
  } catch { /* world_npcs may not exist */ }

  // ── skill_cross_requirements — for cross-skill unlocks ───────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_cross_requirements (
      id               TEXT PRIMARY KEY,
      skill_type       TEXT NOT NULL,   -- the skill being unlocked
      requires_skill   TEXT NOT NULL,   -- prerequisite skill type
      min_level        INTEGER NOT NULL DEFAULT 20,
      UNIQUE(skill_type, requires_skill)
    );
  `);

  // Seed cross-skill requirements
  const crossReqs = [
    // Cross-skills require mastery of at least 2 constituent skills
    ['fire_martial',  'combat', 20],
    ['fire_martial',  'magic',  20],
    ['tech_stealth',  'hacking', 20],
    ['tech_stealth',  'stealth', 20],
    ['bio_combat',    'power',  20],
    ['bio_combat',    'combat', 20],
    ['psi_tactics',   'telepathy', 20],
    ['psi_tactics',   'tactics', 20],
    ['shadow_magic',  'magic',  25],
    ['shadow_magic',  'stealth', 25],
    ['storm_archery', 'combat', 15],
    ['storm_archery', 'magic',  15],
    ['alchemy_bomb',  'alchemy', 20],
    ['alchemy_bomb',  'engineering', 15],
  ];

  const insertCrossReq = db.prepare(`
    INSERT OR IGNORE INTO skill_cross_requirements (id, skill_type, requires_skill, min_level)
    VALUES (?, ?, ?, ?)
  `);
  for (const [skill, req, level] of crossReqs) {
    insertCrossReq.run(`${skill}:${req}`, skill, req, level);
  }

  // ── Add bar_cost / resource_bar / resistance fields to skill DTU hints ───
  // (stored in DTU data JSON — no schema change needed, documenting here)
  // DTU data fields for spell/ability types:
  //   resource_bar: 'mana'|'stamina'|'bio_power'|'perception'|'multi'
  //   bar_cost: number (amount deducted per use)
  //   secondary_bar: string (if multi)
  //   secondary_bar_cost: number
  //   element: 'fire'|'ice'|'lightning'|'physical'|'poison'|'bio'|'energy'|'none'
  //   status_effects: string[]
  //   aoe_radius: number (meters, 0 = single target)
  //   range: number (meters)
  //   cooldown_ms: number
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS skill_cross_requirements;
    DROP TABLE IF EXISTS damage_events;
    DROP TABLE IF EXISTS player_resource_bars;
  `);
}
