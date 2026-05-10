// server/lib/quest-emergence.js
// Detect NPC needs that can only be met by players and generate quests from them.
// 20% of quests spawn a dedicated target NPC (e.g. "find the lost engineer" spawns an engineer).

import crypto from "crypto";
import { spawnQuestNPC } from "./npc-spawning.js";

const URGENCY_THRESHOLD = 0.5;

// Need types that can produce player quests (vs. self-satisfiable needs)
const PLAYER_DEPENDENT_NEEDS = ["purpose", "social"];

/**
 * Scan an NPC's needs for urgent gaps that only players can fill.
 * Creates world_quests rows for each detected opportunity.
 *
 * @param {object} npc  NPCAgent-like object with { id, worldId, npcType, needs }
 * @param {import('better-sqlite3').Database} db
 * @param {Function} selectBrain
 * @returns {Promise<object[]>}  created quest rows
 */
export async function detectQuestOpportunities(npc, db, selectBrain) {
  const urgentNeeds = PLAYER_DEPENDENT_NEEDS.filter(
    n => (npc.needs?.[n] ?? 1) < URGENCY_THRESHOLD
  );

  const quests = [];
  for (const need of urgentNeeds) {
    const quest = await createQuestFromNeed(npc, need, db, selectBrain);
    if (quest) quests.push(quest);
  }
  return quests;
}

/**
 * Generate a quest record from an NPC need using the subconscious brain.
 *
 * @param {object} npc
 * @param {string} need  e.g. 'purpose'
 * @param {import('better-sqlite3').Database} db
 * @param {Function} selectBrain
 * @returns {Promise<object|null>}
 */
export async function createQuestFromNeed(npc, need, db, selectBrain) {
  let questData;

  try {
    const { handle } = await selectBrain("subconscious", {
      brainOverride: "subconscious",
      callerId: "world:quest-emergence",
    });

    const prompt = `An NPC in a game world needs help from a player.

NPC profile:
- Type: ${npc.npcType}
- World: ${npc.worldId}
- Urgent need: ${need} (current value: ${(npc.needs?.[need] ?? 0).toFixed(2)})

Generate a quest this NPC would give to a player. Return JSON only:
{
  "title": "<quest title>",
  "description": "<2-3 sentences describing what the NPC needs and why>",
  "objectives": [
    { "id": "<uuid-like>", "description": "<action>", "completed": false }
  ],
  "reward": { "xp": <number 10-100>, "items": [], "narrative": "<reward flavour>" }
}`;

    const raw   = await handle.generate(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    questData = JSON.parse(match[0]);
  } catch (_e) {
    // brain unavailable — create minimal fallback quest
    questData = {
      title:       `Help ${npc.npcType} with ${need}`,
      description: `${npc.npcType} needs assistance with ${need} in ${npc.worldId}.`,
      objectives:  [{ id: crypto.randomUUID(), description: `Assist the ${npc.npcType}`, completed: false }],
      reward:      { xp: 20, items: [], narrative: "Gratitude and a small reward." },
    };
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO world_quests (id, world_id, giver_npc_id, title, description, objectives_json, reward_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    npc.worldId,
    npc.id,
    questData.title,
    questData.description,
    JSON.stringify(questData.objectives),
    JSON.stringify(questData.reward),
  );


  const questRow = db.prepare("SELECT * FROM world_quests WHERE id = ?").get(id);

  // 20% chance: spawn a dedicated target NPC for this quest
  // (gives players something to find, rescue, or protect — not just an abstract objective)
  if (Math.random() < 0.20) {
    try {
      const needArchetypeMap = {
        purpose: 'engineer', social: 'trader', safety: 'guard',
        hunger: 'farmer', rest: 'medic',
      };
      const targetArchetype = needArchetypeMap[need] || npc.archetype || 'traveler';
      const targetNPCId = spawnQuestNPC(db, id, npc.worldId, {
        archetype:    targetArchetype,
        faction:      'neutral',
        level:        Math.max(1, (npc.level || 1) - 1),
        name:         questData.title?.split(' ').slice(-1)[0] || targetArchetype,
        is_conscious: false,
        is_immortal:  false,
      });
      // Patch the quest objectives to reference the target NPC
      const objectives = JSON.parse(questData.objectives ? JSON.stringify(questData.objectives) : '[]');
      if (objectives.length > 0) {
        objectives[0].target_npc_id = targetNPCId;
        db.prepare('UPDATE world_quests SET objectives_json = ? WHERE id = ?')
          .run(JSON.stringify(objectives), id);
      }
    } catch { /* non-fatal — spawning is best-effort */ }
  }

  return questRow;
}

/**
 * Return available and active quests for a world.
 * @param {string} worldId
 * @param {string} status  'available' | 'active' | 'completed' | 'all'
 * @param {import('better-sqlite3').Database} db
 * @returns {object[]}
 */
export function getWorldQuests(worldId, status, db) {
  const q = status === "all"
    ? db.prepare("SELECT * FROM world_quests WHERE world_id = ? ORDER BY created_at DESC").all(worldId)
    : db.prepare("SELECT * FROM world_quests WHERE world_id = ? AND status = ? ORDER BY created_at DESC").all(worldId, status);

  return q.map(row => ({
    ...row,
    objectives: _tryParseJSON(row.objectives_json, []),
    reward:     _tryParseJSON(row.reward_json,     {}),
  }));
}

/**
 * Map an incoming event to objective progress and check completion.
 * @param {string} questId
 * @param {object} event  { objectiveId?, type, payload? }
 * @param {import('better-sqlite3').Database} db
 * @returns {{ updated: boolean, completed: boolean }}
 */
export function updateQuestProgress(questId, event, db) {
  const row = db.prepare("SELECT * FROM world_quests WHERE id = ?").get(questId);
  if (!row || row.status !== "active") return { updated: false, completed: false };

  const objectives = _tryParseJSON(row.objectives_json, []);
  let changed = false;

  if (event.objectiveId) {
    const obj = objectives.find(o => o.id === event.objectiveId);
    if (obj && !obj.completed) {
      obj.completed = true;
      changed = true;
    }
  }

  const allDone = objectives.every(o => o.completed);

  if (changed || allDone) {
    db.prepare(`
      UPDATE world_quests
      SET objectives_json = ?,
          status = ?,
          completed_at = CASE WHEN ? THEN unixepoch() ELSE completed_at END
      WHERE id = ?
    `).run(JSON.stringify(objectives), allDone ? "completed" : "active", allDone ? 1 : 0, questId);
  }

  return { updated: changed, completed: allDone };
}

function _tryParseJSON(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}
