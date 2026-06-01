// server/lib/npc-spawning.js
// Flexible NPC spawning methods beyond world-seed:
//   1. Quest-spawned  — a quest's objectives or narrative triggers a specific NPC
//   2. Cross-world recruitment — emergent or player brings an NPC from another world
//   3. Civilian recruitment — friendly/enemy NPC recruits a neutral bystander
//      (more likely if the recruiter's faction killed the civilian's family)

import crypto from 'crypto';
import logger from '../logger.js';
import { addFamilyBond, getFamilyMembers } from './npc-family.js';
import { assignPurpose, PURPOSE_ENABLED } from './npc/purpose.js';

// ── Quest-Spawned NPCs ────────────────────────────────────────────────────────

/**
 * Spawn an NPC that exists because of a quest's narrative requirements.
 * Example: "Find the lost engineer" → spawns an engineer NPC in the target zone.
 *
 * @param {object} db
 * @param {string} questId
 * @param {string} worldId
 * @param {{ archetype, body_type, faction, level, is_conscious, is_immortal, name }} opts
 * @returns {string} npcId
 */
export function spawnQuestNPC(db, questId, worldId, opts = {}) {
  const id       = crypto.randomUUID();
  const spawnLoc = JSON.stringify({
    x: (Math.random() - 0.5) * 400,
    y: 0,
    z: (Math.random() - 0.5) * 400,
  });

  db.prepare(`
    INSERT INTO world_npcs
      (id, world_id, npc_type, archetype, body_type, faction,
       level, is_conscious, is_immortal, quest_giver, spawned_by_quest,
       spawn_method, spawn_location, current_location, state)
    VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)
  `).run(
    id, worldId,
    opts.archetype || 'generic',
    opts.archetype || 'generic',
    opts.body_type  || 'humanoid',
    opts.faction    || 'neutral',
    opts.level      || 1,
    opts.is_conscious ? 1 : 0,
    opts.is_immortal  ? 1 : 0,
    questId,
    'quest',
    spawnLoc, spawnLoc,
    JSON.stringify({ name: opts.name || opts.archetype, questSpawned: questId }),
  );

  logger.info('npc-spawning', 'quest_spawn', { id, questId, worldId, archetype: opts.archetype });
  return id;
}

// ── Cross-World Recruitment ───────────────────────────────────────────────────

/**
 * Recruit an NPC from another world and move it to the target world.
 * The recruiter can be a player ID or an emergent/NPC ID.
 *
 * @param {object} db
 * @param {string} npcId          — the NPC being recruited
 * @param {string} targetWorldId  — destination world
 * @param {string} recruiterId    — who recruited them
 * @param {'player'|'npc'|'emergent'} recruiterType
 * @returns {{ ok: boolean, npcId, fromWorld, toWorld }}
 */
export function recruitFromWorld(db, npcId, targetWorldId, recruiterId, recruiterType = 'player') {
  const npc = db.prepare('SELECT * FROM world_npcs WHERE id = ? AND is_dead = 0').get(npcId);
  if (!npc) return { ok: false, error: 'npc_not_found' };
  if (npc.is_immortal) return { ok: false, error: 'immortal_cannot_be_recruited' };

  const fromWorld = npc.world_id;
  if (fromWorld === targetWorldId) return { ok: false, error: 'same_world' };

  // Check consent: NPC is willing if recruiter is allied faction or high-reputation player
  // Simplified: NPCs of the same faction or neutral NPCs are willing
  const targetWorld = db.prepare('SELECT * FROM worlds WHERE id = ?').get(targetWorldId);
  if (!targetWorld) return { ok: false, error: 'target_world_not_found' };

  db.prepare(`
    UPDATE world_npcs
    SET world_id = ?, recruited_by = ?, recruited_from = ?,
        spawn_method = 'cross_world', current_location = '{"x":0,"y":0,"z":0}'
    WHERE id = ?
  `).run(targetWorldId, recruiterId, fromWorld, npcId);

  logger.info('npc-spawning', 'cross_world_recruit', {
    npcId, fromWorld, targetWorldId, recruiterId, recruiterType,
  });

  // NPC purpose — "find purpose in whatever world you move to". Clear the old
  // world's home + job binding (they belong to fromWorld) and re-assign a home +
  // workplace (or roam) in the destination. Best-effort; flag-gated.
  if (PURPOSE_ENABLED()) {
    try {
      db.prepare(`UPDATE world_npcs SET home_building_id = NULL WHERE id = ?`).run(npcId);
      db.prepare(`DELETE FROM npc_jobs WHERE npc_id = ?`).run(npcId);
      assignPurpose(db, npcId, targetWorldId);
    } catch { /* best-effort — purpose tables optional on minimal builds */ }
  }

  return { ok: true, npcId, fromWorld, toWorld: targetWorldId };
}

// ── Civilian Recruitment ──────────────────────────────────────────────────────

/**
 * An NPC tries to recruit a nearby neutral civilian to their faction.
 * Probability is influenced by:
 *   - Base chance (low — civilians don't just join factions)
 *   - Grief level of the civilian (high grief = much more likely to join enemy faction)
 *   - Whether the recruiter's faction killed someone the civilian knew
 *   - Recruiter's level/persuasion (higher level = more persuasive)
 *
 * @param {object} db
 * @param {string} recruiterId   — NPC doing the recruiting
 * @param {string} civilianId    — target neutral NPC
 * @returns {{ recruited: boolean, newFaction?: string, reason?: string }}
 */
export function attemptCivilianRecruitment(db, recruiterId, civilianId) {
  const recruiter = db.prepare('SELECT * FROM world_npcs WHERE id = ? AND is_dead = 0').get(recruiterId);
  const civilian  = db.prepare('SELECT * FROM world_npcs WHERE id = ? AND is_dead = 0').get(civilianId);

  if (!recruiter || !civilian) return { recruited: false };
  if (civilian.faction !== 'neutral' && civilian.faction !== 'hero') return { recruited: false }; // already recruited
  if (civilian.is_conscious || civilian.is_immortal) return { recruited: false };

  // Base recruitment probability
  let probability = 0.04; // 4% base

  // Grief dramatically increases willingness to join hostile faction
  const grief = civilian.grief_level ?? 0;
  probability += grief * 0.40; // max +40% at full grief

  // Level-based persuasion
  const levelBonus = Math.min(0.10, ((recruiter.level || 1) - 1) * 0.01);
  probability += levelBonus;

  // If the recruiter's faction killed someone the civilian knows, it's the WRONG faction to join
  // (grief pushes toward enemy of killer, not killer itself)
  const killReason = civilian.radicalized_reason || '';
  if (killReason.includes(recruiter.faction)) {
    probability *= 0.1; // very unlikely to join the killers
  }

  if (Math.random() > probability) return { recruited: false };

  // Civilian joins recruiter's faction
  const originalFaction = civilian.faction;
  const newFaction = recruiter.faction;

  db.prepare(`
    UPDATE world_npcs
    SET faction = ?, recruited_by = ?, spawn_method = 'recruited',
        original_faction = COALESCE(original_faction, ?)
    WHERE id = ?
  `).run(newFaction, recruiterId, originalFaction, civilianId);

  logger.info('npc-spawning', 'civilian_recruited', {
    civilianId, recruiterId, originalFaction, newFaction, grief,
  });

  return {
    recruited: true,
    newFaction,
    originalFaction,
    reason: grief > 0.3 ? 'grief' : 'persuasion',
  };
}

/**
 * Scan a world for recruitabl civilians near each NPC faction group.
 * Called by NPCSimulator on social tick (low frequency).
 */
export function tickRecruitment(db, worldId) {
  const factionNPCs = db.prepare(`
    SELECT id, faction, level FROM world_npcs
    WHERE world_id = ? AND is_dead = 0 AND faction != 'neutral' AND faction != 'hero'
    LIMIT 20
  `).all(worldId);

  const neutrals = db.prepare(`
    SELECT id FROM world_npcs
    WHERE world_id = ? AND is_dead = 0 AND faction = 'neutral'
    ORDER BY RANDOM() LIMIT 5
  `).all(worldId);

  if (!factionNPCs.length || !neutrals.length) return [];

  const results = [];
  for (const npc of factionNPCs.slice(0, 3)) {
    for (const neutral of neutrals.slice(0, 2)) {
      const result = attemptCivilianRecruitment(db, npc.id, neutral.id);
      if (result.recruited) results.push({ recruiterId: npc.id, civilianId: neutral.id, ...result });
    }
  }
  return results;
}

/**
 * Utility: check if a given killer (player or NPC) has killed multiple NPCs
 * from the same faction/family, which amplifies radicalization across the world.
 * Returns a "blood debt" score (0–1) used to scale radicalization probability.
 */
export function computeBloodDebt(db, killerId, worldId) {
  try {
    const recentKills = db.prepare(`
      SELECT COUNT(*) as n FROM npc_deaths
      WHERE killer_id = ? AND world_id = ?
        AND killed_at > unixepoch() - 86400
    `).get(killerId, worldId)?.n ?? 0;
    return Math.min(1.0, recentKills / 10); // 10+ kills in 24h = max blood debt
  } catch { return 0; }
}
