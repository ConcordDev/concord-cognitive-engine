// kingdoms.js#recomputeCitizenLoyalty looks up each realm's citizens by
// world_npcs.faction, for every realm, every kingdom-decree cycle. With no
// index on faction that was a full scan of world_npcs per realm (live
// 2026-10-23: 16,449 NPCs x 66 realms), a 0.75-0.9 s event-loop block each
// cycle in the CPU profile.

export function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_world_npcs_faction ON world_npcs(faction);
  `);
}

export function down(db) {
  db.exec("DROP INDEX IF EXISTS idx_world_npcs_faction");
}

export const description = "Index world_npcs.faction for realm citizen lookups";
