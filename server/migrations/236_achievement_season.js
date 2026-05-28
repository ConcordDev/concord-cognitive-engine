// server/migrations/236_achievement_season.js
//
// Phase BB2 — seasonal achievement gating.
//
// Skip the battle pass entirely (user's pick). Just stamp the active
// season + year onto every unlock so players can earn "Season 3
// Warrior" badges. Cheap, no FOMO ladder, ladders onto the existing
// 38-achievement substrate.
//
// player_achievements (mig 047) is PK (player_id, achievement_id), so
// the same player CAN'T re-earn the same achievement in a later season
// — that's by design. What seasonal gating gives us is:
//   1. Achievements unlocked DURING a season carry that stamp for
//      leaderboards.
//   2. Achievements with `seasonOnly: <idx>` declared in their JSON
//      only unlock during that season (loader enforces).
//   3. Achievements with `festivalOnly: <festival_id>` only unlock
//      while that festival_active row is current.

export function up(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(player_achievements)`).all().map(c => c.name);
    if (!cols.includes("season_idx")) {
      db.exec(`ALTER TABLE player_achievements ADD COLUMN season_idx INTEGER`);
    }
    if (!cols.includes("year_idx")) {
      db.exec(`ALTER TABLE player_achievements ADD COLUMN year_idx INTEGER`);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_player_achievements_season
        ON player_achievements(player_id, season_idx, year_idx)
    `);
  } catch { /* table missing on minimal build */ }
}

export function down(_db) {
  // SQLite older versions can't DROP COLUMN; leave in place on down.
}
