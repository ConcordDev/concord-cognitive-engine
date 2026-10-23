// What kind of being an NPC archetype is. Shared by the NPC simulator (what an
// NPC can do) and quest emergence (who can give a quest): creatures and
// monsters forage, roam and fight; they don't trade, talk or post quests.

const MONSTER_ARCHETYPES = new Set([
  "undead", "wraith", "lich_king", "dragon_lord", "dark_jarl", "drift_eater",
  "shard_husk", "goblin", "orc_warrior", "dark_wizard",
]);

/** True for people (traders, guards, scholars...), false for creatures and monsters. */
export function isPeopleArchetype(archetype) {
  const a = String(archetype || "");
  if (a.startsWith("creature:")) return false;
  return !MONSTER_ARCHETYPES.has(a);
}

/** Archetypes a player can be asked to deal with. */
export function isHostileArchetype(archetype) {
  return MONSTER_ARCHETYPES.has(String(archetype || ""));
}
