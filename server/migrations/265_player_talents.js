// server/migrations/265_player_talents.js
//
// F2.3 — player talent allocation.
//
// Skill XP + levels are real (player_skill_levels), but talent ALLOCATION was
// missing — the only skill tree in the app is education/SkillTree (academic,
// display-only). This adds a real combat/utility talent tree: players earn 1
// point per level (gainSkillXP hook) and spend them into nodes that change
// gameplay (read by the combat path, like affixes).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_talent_points (
      user_id    TEXT PRIMARY KEY,
      available  INTEGER NOT NULL DEFAULT 0,
      earned     INTEGER NOT NULL DEFAULT 0,
      spent      INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_talent_allocations (
      user_id    TEXT NOT NULL,
      talent_id  TEXT NOT NULL,
      rank       INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, talent_id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_talent_alloc_user ON player_talent_allocations(user_id);`);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS player_talent_allocations;`);
  db.exec(`DROP TABLE IF EXISTS player_talent_points;`);
}
