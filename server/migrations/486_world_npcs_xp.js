// NPCs earn XP from work and finished quests (lib/npc-life.js) and level up
// from it. world_npcs had a level (rolled at spawn, never changed) but nowhere
// to keep XP.

export function up(db) {
  const cols = db.prepare("SELECT name FROM pragma_table_info('world_npcs')").all().map((c) => c.name);
  if (cols.length && !cols.includes("xp")) {
    db.exec("ALTER TABLE world_npcs ADD COLUMN xp INTEGER NOT NULL DEFAULT 0");
  }
}

export function down() {
  // SQLite can't drop a column without a table rebuild; the column is inert if unused.
}

export const description = "world_npcs.xp for NPC leveling";
