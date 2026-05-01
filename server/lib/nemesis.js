// server/lib/nemesis.js
// When an NPC kills a player, the NPC becomes their named nemesis — gaining a title
// and growing stronger. When the player kills their nemesis, the record is cleared and
// the player earns Sparks + a chronicle entry.
//
// Combat memory: the nemesis records which player tactics landed, which failed,
// and which caused it to retreat. On the next encounter it counters what worked.

import crypto from "crypto";
import logger from "../logger.js";

const NEMESIS_KILL_SPARKS = 50;
const NPC_LEVEL_BOOST = 0.5; // added to nemesis NPC's combat skill levels

export function getNemesisForPlayer(db, playerId) {
  return db.prepare("SELECT * FROM nemesis_records WHERE player_id = ?").get(playerId) || null;
}

export async function onNPCKilledPlayer(db, npcId, playerId, worldId, selectBrain) {
  const existing = db.prepare("SELECT * FROM nemesis_records WHERE player_id = ?").get(playerId);
  const npc = db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(npcId);
  if (!npc) return null;

  const npcName = npc.state ? (JSON.parse(npc.state)?.name || `NPC-${npcId.slice(0, 6)}`) : `NPC-${npcId.slice(0, 6)}`;
  const playerName = db.prepare("SELECT username FROM users WHERE id = ?").get(playerId)?.username || "Unknown";

  let title = `The Slayer of ${playerName}`;
  try {
    const brain = selectBrain("subconscious", { callerId: "concordia:nemesis-title" });
    const res = await brain.complete([{
      role: "user",
      content: `Generate a short, dramatic villain title (4–8 words) for an NPC named "${npcName}" who just killed a player named "${playerName}" in a world called "${worldId}". Return ONLY the title, no quotes or explanation.`,
    }]);
    const candidate = res?.content?.[0]?.text?.trim();
    if (candidate && candidate.length < 60) title = candidate;
  } catch (err) {
    logger?.debug?.('[nemesis] optional step skipped', { reason: err?.message });
  }

  if (existing) {
    db.prepare(`UPDATE nemesis_records SET kill_count = kill_count + 1, npc_title = ?, last_encounter = ? WHERE player_id = ?`)
      .run(title, Date.now(), playerId);
  } else {
    db.prepare(`INSERT INTO nemesis_records (player_id, npc_id, npc_name, npc_title, kill_count, last_encounter, world_id) VALUES (?,?,?,?,1,?,?)`)
      .run(playerId, npcId, npcName, title, Date.now(), worldId);
  }

  // Strengthen the nemesis NPC's combat skills
  db.prepare(`UPDATE dtus SET skill_level = MIN(skill_level + ?, 9999) WHERE creator_id = ? AND type = 'skill'`)
    .run(NPC_LEVEL_BOOST, npcId);

  return { npcName, title };
}

export async function onPlayerKilledNemesis(db, playerId, npcId, realtimeEmit) {
  const nemesis = db.prepare("SELECT * FROM nemesis_records WHERE player_id = ? AND npc_id = ?").get(playerId, npcId);
  if (!nemesis) return false;

  db.prepare("DELETE FROM nemesis_records WHERE player_id = ?").run(playerId);

  // Award Sparks (gameplay reward — never CC)
  try {
    const { awardSparks } = await import("./currency.js");
    awardSparks(db, playerId, NEMESIS_KILL_SPARKS, "nemesis_kill", nemesis.world_id);
  } catch (err) {
    logger?.debug?.('[nemesis] optional step skipped', { reason: err?.message });
  }

  // Unlock achievement via world-progression if available
  try {
    const { trackAction } = await import("./world-progression.js");
    trackAction(db, playerId, "nemesis_slain");
  } catch (err) {
    logger?.debug?.('[nemesis] optional step skipped', { reason: err?.message });
  }

  // Chronicle entry
  try {
    const { recordEvent } = await import("../emergent/history-engine.js");
    recordEvent("breakthrough", {
      actorId: playerId,
      description: `${nemesis.npc_title} was defeated after ${nemesis.kill_count} encounter(s).`,
      significance: "nemesis_defeated",
    });
  } catch (err) {
    logger?.debug?.('[nemesis] optional step skipped', { reason: err?.message });
  }

  realtimeEmit("world:notification", {
    userId: playerId,
    message: `Nemesis defeated! ${nemesis.npc_title} has fallen. +${NEMESIS_KILL_SPARKS} Sparks`,
    type: "milestone",
  });

  return true;
}

// ── Combat Memory ────────────────────────────────────────────────────────────
// combatLog shape: {
//   playerAttacks: [{ type: string, hit: boolean }],
//   outcome: 'player_died' | 'npc_retreated',
//   roundCount: number,
// }

/**
 * Record what attack types the player used and which ones landed.
 * Called after any combat encounter where the NPC survives or wins.
 */
export function recordCombatMemory(db, npcId, playerId, combatLog) {
  const rec = db.prepare(
    "SELECT combat_memory, tactics_countered, encounter_count FROM nemesis_records WHERE player_id = ? AND npc_id = ?"
  ).get(playerId, npcId);

  if (!rec) return;

  const memory = _parseJSON(rec.combat_memory, { playerTactics: {}, roundsTotal: 0 });
  const tactics = memory.playerTactics || {};

  for (const attack of (combatLog.playerAttacks || [])) {
    const key = attack.type || 'unknown';
    if (!tactics[key]) tactics[key] = { attempts: 0, hits: 0 };
    tactics[key].attempts++;
    if (attack.hit) tactics[key].hits++;
  }

  memory.playerTactics = tactics;
  memory.roundsTotal   = (memory.roundsTotal || 0) + (combatLog.roundCount || 1);
  memory.lastOutcome   = combatLog.outcome;

  // If NPC retreated, record which tactic forced the retreat
  const retreatTactics = _parseJSON(rec.tactics_countered, []);
  if (combatLog.outcome === 'npc_retreated') {
    const highestHitRate = Object.entries(tactics)
      .sort(([, a], [, b]) => (b.hits / (b.attempts || 1)) - (a.hits / (a.attempts || 1)))[0];
    if (highestHitRate && !retreatTactics.includes(highestHitRate[0])) {
      retreatTactics.push(highestHitRate[0]);
    }
  }

  db.prepare(`
    UPDATE nemesis_records
    SET combat_memory = ?, tactics_countered = ?, encounter_count = encounter_count + 1,
        last_retreat = CASE WHEN ? = 'npc_retreated' THEN unixepoch() ELSE last_retreat END
    WHERE player_id = ? AND npc_id = ?
  `).run(
    JSON.stringify(memory),
    JSON.stringify(retreatTactics),
    combatLog.outcome || '',
    playerId, npcId
  );
}

/**
 * Get tactical advantages the NPC should use against this player based on memory.
 * Returns { resistances: string[], counters: string[], retreatTriggers: string[] }
 * Resistances: attack types to resist (player relied on these and they worked)
 * Counters: attack types the NPC should use (what worked against player)
 * RetreatTriggers: what caused the NPC to retreat before (avoid these situations)
 */
export function getCombatAdvantages(db, npcId, playerId) {
  const rec = db.prepare(
    "SELECT combat_memory, tactics_countered FROM nemesis_records WHERE player_id = ? AND npc_id = ?"
  ).get(playerId, npcId);

  if (!rec) return { resistances: [], counters: [], retreatTriggers: [] };

  const memory   = _parseJSON(rec.combat_memory, { playerTactics: {} });
  const tactics  = memory.playerTactics || {};

  // Attacks with >50% hit rate are what the player relies on — NPC resists these
  const resistances = Object.entries(tactics)
    .filter(([, v]) => v.attempts >= 2 && (v.hits / v.attempts) > 0.5)
    .map(([k]) => k);

  // Attacks that failed the player (low hit rate) — NPC exploits the gap
  const counters = Object.entries(tactics)
    .filter(([, v]) => v.attempts >= 2 && (v.hits / v.attempts) < 0.3)
    .map(([k]) => k);

  const retreatTriggers = _parseJSON(rec.tactics_countered, []);

  return { resistances, counters, retreatTriggers };
}

function _parseJSON(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}
