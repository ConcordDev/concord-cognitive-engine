// server/lib/npc-consequences.js
// Consequence cascade when an NPC dies:
//   1. Marks NPC dead in DB
//   2. Logs death record
//   3. Starts property disrepair clock on NPC's home DTU
//   4. Impacts any quests this NPC was giving
//   5. Rare: NPC "migrates" to another world instead of dying
// processDisrepairTick() runs on a server heartbeat interval.

import crypto from "crypto";
import logger from "../logger.js";

const MIGRATION_CHANCE    = 0.08;  // 8% of high-affinity NPCs escape death by migrating
const DISREPAIR_RATE      = 0.05;  // per tick — full disrepair in ~20 ticks (days)
const DISREPAIR_TICK_MS   = 86_400_000; // 24h in production, configurable via env

// ── NPC Death ────────────────────────────────────────────────────────

/**
 * Handle NPC death. Conscious/immortal NPCs cannot die — returns false.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} npcId
 * @param {string} killerId — player or NPC who killed it
 * @param {function} realtimeEmit
 * @returns {{ died: boolean, migrated: boolean, consequence: object }}
 */
export async function triggerNPCDeath(db, npcId, killerId, realtimeEmit) {
  const npc = db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(npcId);
  if (!npc) return { died: false, reason: 'not_found' };

  // Conscious emergents are immortal — cannot be killed
  if (npc.is_conscious || npc.is_immortal) {
    return { died: false, reason: 'immortal' };
  }

  // Already dead
  if (npc.is_dead) return { died: false, reason: 'already_dead' };

  // Migration chance — high-affinity NPCs with homes "escape" to another world
  const migrated = await _attemptMigration(db, npc);
  if (migrated) {
    realtimeEmit?.('world:npc-event', {
      worldId: npc.world_id,
      type:    'migration',
      npcId,
      name:    _npcName(npc),
      message: `${_npcName(npc)} has fled to another world.`,
    });
    return { died: false, migrated: true };
  }

  // Mark dead
  db.prepare(
    "UPDATE world_npcs SET is_dead = 1, died_at = unixepoch(), killer_id = ? WHERE id = ?"
  ).run(killerId, npcId);

  // Log death record
  const deathId = crypto.randomUUID();
  const consequence = _buildConsequence(db, npc);
  db.prepare(
    "INSERT INTO npc_deaths (id, npc_id, world_id, killer_id, consequence) VALUES (?,?,?,?,?)"
  ).run(deathId, npcId, npc.world_id, killerId, JSON.stringify(consequence));

  // Quest impact — mark quests from this NPC as needing alternative path
  _impactQuests(db, npcId);

  // Emit world event
  realtimeEmit?.('world:npc-event', {
    worldId:     npc.world_id,
    type:        'death',
    npcId,
    name:        _npcName(npc),
    archetype:   npc.archetype,
    faction:     npc.faction,
    consequence,
    message:     `${_npcName(npc)} has been slain. Their story continues to echo.`,
  });

  logger.info('npc-consequences', 'npc_died', { npcId, worldId: npc.world_id, killer: killerId, archetype: npc.archetype });

  return { died: true, migrated: false, consequence };
}

// ── Disrepair Tick ────────────────────────────────────────────────────

/**
 * Run once per day. Increments disrepair on dead NPCs' homes.
 * Call from a server heartbeat interval.
 */
export function processDisrepairTick(db) {
  const deadNpcs = db.prepare(
    "SELECT * FROM world_npcs WHERE is_dead = 1 AND disrepair_level < 1 AND home_dtu_id IS NOT NULL"
  ).all();

  for (const npc of deadNpcs) {
    const newLevel = Math.min(1, (npc.disrepair_level || 0) + DISREPAIR_RATE);

    db.prepare("UPDATE world_npcs SET disrepair_level = ? WHERE id = ?")
      .run(newLevel, npc.id);

    // Update the home DTU's quality to reflect abandonment
    if (npc.home_dtu_id) {
      try {
        db.prepare(
          "UPDATE dtus SET metadata = json_patch(COALESCE(metadata,'{}'), ?) WHERE id = ?"
        ).run(JSON.stringify({ condition: Math.max(0, 1 - newLevel), abandoned: true }), npc.home_dtu_id);
      } catch { /* non-fatal */ }
    }

    // At full disrepair, log collapse event
    if (newLevel >= 1) {
      logger.info('npc-consequences', 'property_collapsed', { npcId: npc.id, homeDtuId: npc.home_dtu_id });
    }
  }

  return deadNpcs.length;
}

export const DISREPAIR_TICK_INTERVAL = DISREPAIR_TICK_MS;

// ── Helpers ───────────────────────────────────────────────────────────

function _npcName(npc) {
  const state = _tryParseJSON(npc.state, {});
  return state.name || npc.archetype || `NPC-${npc.id.slice(0, 6)}`;
}

function _buildConsequence(db, npc) {
  const consequence = {
    hasHome:       !!npc.home_dtu_id,
    wasQuestGiver: !!npc.quest_giver,
    archetype:     npc.archetype,
    faction:       npc.faction,
  };

  // Check if this NPC had active quests
  try {
    const questCount = db.prepare(
      "SELECT COUNT(*) as n FROM world_quests WHERE giver_npc_id = ? AND status = 'active'"
    ).get(npc.id)?.n || 0;
    consequence.activeQuests = questCount;
  } catch { /* non-fatal */ }

  return consequence;
}

function _impactQuests(db, npcId) {
  try {
    // Mark NPC's active quests as needing alternative path
    db.prepare(
      "UPDATE world_quests SET status = 'giver_dead' WHERE giver_npc_id = ? AND status = 'active'"
    ).run(npcId);
  } catch { /* non-fatal */ }
}

async function _attemptMigration(db, npc) {
  if (!npc.home_dtu_id) return false; // only NPCs with established homes can migrate
  if (Math.random() > MIGRATION_CHANCE) return false;

  // Find another world to migrate to
  try {
    const otherWorlds = db.prepare(
      "SELECT id FROM worlds WHERE id != ? AND status = 'active' ORDER BY RANDOM() LIMIT 1"
    ).all(npc.world_id);

    if (!otherWorlds.length) return false;

    const destWorldId = otherWorlds[0].id;
    db.prepare(
      "UPDATE world_npcs SET world_id = ?, current_location = '{}', migrated_at = unixepoch() WHERE id = ?"
    ).run(destWorldId, npc.id);

    // Log migration
    db.prepare(
      "INSERT INTO npc_deaths (id, npc_id, world_id, killer_id, migrated_to) VALUES (?,?,?,?,?)"
    ).run(crypto.randomUUID(), npc.id, npc.world_id, null, destWorldId);

    return true;
  } catch {
    return false;
  }
}

function _tryParseJSON(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}
