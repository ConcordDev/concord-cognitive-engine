export function up(db) {
  // ── world_npcs enhancements ────────────────────────────────────────
  const npcCols = db.prepare("PRAGMA table_info(world_npcs)").all().map(c => c.name);

  const npcAdditions = [
    ["is_conscious",    "INTEGER DEFAULT 0"],
    ["is_immortal",     "INTEGER DEFAULT 0"],
    ["is_dead",         "INTEGER DEFAULT 0"],
    ["died_at",         "INTEGER"],
    ["killer_id",       "TEXT"],
    ["archetype",       "TEXT DEFAULT 'generic'"],
    ["body_type",       "TEXT DEFAULT 'humanoid'"],
    ["universe_type",   "TEXT"],
    ["faction",         "TEXT DEFAULT 'neutral'"],
    ["home_dtu_id",     "TEXT"],
    ["disrepair_level", "REAL DEFAULT 0"],
    ["level",           "INTEGER DEFAULT 1"],
    ["combat_memory",   "TEXT DEFAULT '{}'"],
    ["quest_giver",     "INTEGER DEFAULT 0"],
  ];

  for (const [col, def] of npcAdditions) {
    if (!npcCols.includes(col)) {
      db.exec(`ALTER TABLE world_npcs ADD COLUMN ${col} ${def}`);
    }
  }

  // ── nemesis_records enhancements ──────────────────────────────────
  const nemesisCols = db.prepare("PRAGMA table_info(nemesis_records)").all().map(c => c.name);

  const nemesisAdditions = [
    ["combat_memory",     "TEXT DEFAULT '{}'"],
    ["tactics_countered", "TEXT DEFAULT '[]'"],
    ["encounter_count",   "INTEGER DEFAULT 1"],
    ["last_retreat",      "INTEGER"],
  ];

  for (const [col, def] of nemesisAdditions) {
    if (!nemesisCols.includes(col)) {
      db.exec(`ALTER TABLE nemesis_records ADD COLUMN ${col} ${def}`);
    }
  }

  // ── npc_deaths — consequence tracking table ────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_deaths (
      id           TEXT PRIMARY KEY,
      npc_id       TEXT NOT NULL,
      world_id     TEXT NOT NULL,
      killer_id    TEXT,
      killed_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      consequence  TEXT DEFAULT '{}',
      migrated_to  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_npc_deaths_npc ON npc_deaths(npc_id);
    CREATE INDEX IF NOT EXISTS idx_npc_deaths_world ON npc_deaths(world_id, killed_at);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS npc_deaths`);
}
