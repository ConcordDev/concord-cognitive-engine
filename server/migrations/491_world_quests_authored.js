// world_quests holds two kinds of row. Procedural quests (quest-emergence.js)
// are single-consumer: one taker, then they expire or complete for everyone.
// Authored quests (content/ via content-seeder.js) are a shared catalog that
// every player accepts independently; per-player state lives in player_quests.
// Nothing told them apart, so the procedural lifecycle ran on authored rows:
// expireStaleQuests marked all 146 authored quests 'expired' on the live DB
// (2026-10-26), npc-life let NPCs claim them, and the first player to finish
// one closed it for everyone. `authored` is set by the seeder on every boot.

export function up(db) {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'world_quests'").get();
  if (!has) return;
  const cols = new Set(db.prepare("PRAGMA table_info(world_quests)").all().map((c) => c.name));
  if (!cols.has("authored")) db.exec("ALTER TABLE world_quests ADD COLUMN authored INTEGER NOT NULL DEFAULT 0");
}

export function down() { /* additive column; nothing to undo safely */ }

export const description = "world_quests.authored — keep the procedural quest lifecycle off authored catalog quests";
