// quest-emergence.js#questGate checks "does this NPC already have an open
// quest?" before posting one. Index the lookup so the check stays a seek as
// the quest table grows.

export function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_world_quests_giver_status ON world_quests(giver_npc_id, status);
  `);
}

export function down(db) {
  db.exec("DROP INDEX IF EXISTS idx_world_quests_giver_status");
}

export const description = "Index world_quests by giver and status for the one-open-quest gate";
