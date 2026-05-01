// server/migrations/062_npc_families_and_spawning.js
// Family dynamics, crossbreeding, and flexible NPC spawning methods.

export function up(db) {
  const npcCols = db.prepare("PRAGMA table_info(world_npcs)").all().map(c => c.name);
  const addNpcCol = (col, def) => {
    if (!npcCols.includes(col))
      db.prepare(`ALTER TABLE world_npcs ADD COLUMN ${col} ${def}`).run();
  };

  // ── Crossbreeding & species ───────────────────────────────────────────────
  addNpcCol('species',         'TEXT    DEFAULT "human"');      // base species tag
  addNpcCol('parent_ids',      'TEXT    DEFAULT "[]"');         // JSON [id, id] — two parents
  addNpcCol('inherited_traits','TEXT    DEFAULT "{}"');         // JSON: blended traits from parents
  addNpcCol('generation',      'INTEGER DEFAULT 0');            // 0 = spawned, 1+ = born in-world
  addNpcCol('spawn_method',    'TEXT    DEFAULT "world_seed"'); -- world_seed|crossbreed|quest|recruited|cross_world

  // ── Family relationships ──────────────────────────────────────────────────
  db.prepare(`
    CREATE TABLE IF NOT EXISTS npc_relationships (
      id           TEXT PRIMARY KEY,
      npc_id       TEXT NOT NULL REFERENCES world_npcs(id),
      related_id   TEXT NOT NULL REFERENCES world_npcs(id),
      rel_type     TEXT NOT NULL,   -- spouse | parent | child | sibling | friend | rival
      strength     REAL DEFAULT 1.0, -- 0→2; above 1 = strong bond, below 0.5 = estranged
      created_at   INTEGER DEFAULT (unixepoch()),
      UNIQUE(npc_id, related_id, rel_type)
    )
  `).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_npc_rel_npc ON npc_relationships(npc_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_npc_rel_related ON npc_relationships(related_id)`).run();

  // ── Grief / radicalization state ──────────────────────────────────────────
  addNpcCol('grief_level',        'REAL    DEFAULT 0');   -- 0→1; >0.7 = radicalization risk
  addNpcCol('radicalized',        'INTEGER DEFAULT 0');   -- 1 = switched faction after grief
  addNpcCol('radicalized_reason', 'TEXT');                -- e.g. "family_killed_by_player:userId"
  addNpcCol('original_faction',   'TEXT');                -- faction before radicalization

  // ── Recruitment tracking ──────────────────────────────────────────────────
  addNpcCol('recruited_by',   'TEXT');   -- npc_id or player_id who recruited this NPC
  addNpcCol('recruited_from', 'TEXT');   -- world_id they came from (cross-world recruits)

  // ── Quest spawn tracking ──────────────────────────────────────────────────
  addNpcCol('spawned_by_quest', 'TEXT');  -- quest_id that triggered this NPC's spawn

  // ── NPC death events (extend for family grief tracking) ───────────────────
  const deathCols = db.prepare("PRAGMA table_info(npc_deaths)").all().map(c => c.name);
  if (!deathCols.includes('notified_family'))
    db.prepare('ALTER TABLE npc_deaths ADD COLUMN notified_family INTEGER DEFAULT 0').run();
}

export function down(db) {
  db.prepare('DROP TABLE IF EXISTS npc_relationships').run();
}
