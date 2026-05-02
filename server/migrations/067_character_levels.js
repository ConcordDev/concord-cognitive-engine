// server/migrations/067_character_levels.js
// Character-level system: every skill level-up awards 2 upgrade points
// spendable on any resource bar's maximum value.

export function up(db) {
  // ── Add character-level tracking to player_resource_bars ─────────────────
  try {
    const cols = db.prepare('PRAGMA table_info(player_resource_bars)').all().map(c => c.name);
    const newCols = [
      ['character_level',    'INTEGER NOT NULL DEFAULT 0'],  // sum of all skill levels gained
      ['pending_upgrades',   'INTEGER NOT NULL DEFAULT 0'],  // unspent upgrade points (2 per level)
      ['total_upgrades_spent','INTEGER NOT NULL DEFAULT 0'], // lifetime spend tracker
    ];
    for (const [col, def] of newCols) {
      if (!cols.includes(col)) db.exec(`ALTER TABLE player_resource_bars ADD COLUMN ${col} ${def}`);
    }
  } catch { /* table may not exist yet */ }

  // ── bar_upgrade_log — record of every upgrade spent ──────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS bar_upgrade_log (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      world_id      TEXT NOT NULL,
      bar_type      TEXT NOT NULL,   -- 'hp'|'mana'|'stamina'|'bio_power'|'perception'
      amount        REAL NOT NULL DEFAULT 10,
      character_level_at INTEGER NOT NULL,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_upgrades_user ON bar_upgrade_log(user_id, created_at DESC);
  `);
}

export function down(db) {
  db.exec('DROP TABLE IF EXISTS bar_upgrade_log;');
}
