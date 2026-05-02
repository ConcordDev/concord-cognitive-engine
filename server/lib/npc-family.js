// server/lib/npc-family.js
// Family bonds, grief-driven radicalization, and crossbreeding.
//
// Family system:
//   - NPCs form spouse/parent/child/sibling bonds tracked in npc_relationships
//   - When a family member is killed, surviving NPCs gain grief_level
//   - Grief above 0.7 triggers radicalization — the NPC switches to an enemy faction
//   - Indiscriminate killing by a player/faction accelerates radicalization across the whole
//     family tree, not just direct kills
//
// Crossbreeding:
//   - Two compatible NPCs of different species can produce offspring
//   - Offspring inherits blended traits: body_type averaged, archetype from dominant parent,
//     faction from parent with stronger social bond, species = "hybrid:<parentA>/<parentB>"
//   - All crossbreeds are physics-validated via the body_type system (size, scale, wing presence)

import crypto from 'crypto';
import logger from '../logger.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const GRIEF_PER_FAMILY_DEATH  = 0.35;  // direct family (spouse/parent/child)
const GRIEF_PER_EXTENDED_DEATH = 0.15; // sibling/friend
const GRIEF_DECAY_PER_TICK    = 0.005; // grief heals slowly over time
const RADICALIZATION_THRESHOLD = 0.70; // grief_level above this = faction switch
const MAX_FAMILY_SIZE         = 8;     // natural family cap per NPC
const CROSSBREED_CHANCE       = 0.002; // per tick between compatible spouses

// Species-to-body-type mapping for crossbreeding physics
const SPECIES_BODY = {
  human:    { scale: 1.0,  wings: false, tail: false, horns: false },
  goblin:   { scale: 0.65, wings: false, tail: false, horns: false },
  dragon:   { scale: 2.5,  wings: true,  tail: true,  horns: true  },
  orc:      { scale: 1.4,  wings: false, tail: false, horns: false },
  elf:      { scale: 1.0,  wings: false, tail: false, horns: false },
  undead:   { scale: 1.0,  wings: false, tail: false, horns: false },
  demon:    { scale: 1.3,  wings: true,  tail: true,  horns: true  },
  alien:    { scale: 1.1,  wings: false, tail: true,  horns: false },
  robot:    { scale: 1.2,  wings: false, tail: false, horns: false },
  werewolf: { scale: 1.5,  wings: false, tail: true,  horns: false },
};

// Enemy factions a radicalized NPC may join (weighted toward aggression)
const RADICALIZATION_FACTIONS = ['villain', 'outlaw', 'cult', 'gang', 'rogue', 'monster'];

// ── Family Bonds ──────────────────────────────────────────────────────────────

/**
 * Create a family relationship between two NPCs.
 * Automatically creates the reciprocal record.
 */
export function addFamilyBond(db, npcIdA, npcIdB, relType, strength = 1.0) {
  const reciprocal = {
    spouse: 'spouse', parent: 'child', child: 'parent',
    sibling: 'sibling', friend: 'friend', rival: 'rival',
  };

  try {
    db.prepare(`
      INSERT OR IGNORE INTO npc_relationships (id, npc_id, related_id, rel_type, strength)
      VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), npcIdA, npcIdB, relType, strength);

    const rev = reciprocal[relType];
    if (rev) {
      db.prepare(`
        INSERT OR IGNORE INTO npc_relationships (id, npc_id, related_id, rel_type, strength)
        VALUES (?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), npcIdB, npcIdA, rev, strength);
    }
  } catch (e) {
    logger.debug('npc-family', 'bond_skip', { reason: e.message });
  }
}

/**
 * Get all family members for a given NPC.
 */
export function getFamilyMembers(db, npcId) {
  try {
    return db.prepare(`
      SELECT r.rel_type, r.strength, n.*
      FROM npc_relationships r
      JOIN world_npcs n ON n.id = r.related_id
      WHERE r.npc_id = ? AND n.is_dead = 0
    `).all(npcId);
  } catch { return []; }
}

/**
 * Form a family unit when two NPCs have been spouses long enough.
 * Called by the NPC simulator on the social tick.
 * Creates parent-child bonds for any offspring.
 */
export function seedFamilyUnit(db, npcIdA, npcIdB) {
  addFamilyBond(db, npcIdA, npcIdB, 'spouse');
}

// ── Grief & Radicalization ────────────────────────────────────────────────────

/**
 * Called when any NPC dies. Notifies surviving family members and increases their grief.
 * Potentially triggers faction radicalization if grief crosses the threshold.
 *
 * @param {string} killedNPCId
 * @param {string} killerId     — player ID or NPC ID
 * @param {string} killerType   — 'player' | 'npc'
 * @param {object} realtimeEmit
 * @returns {{ radicalized: { npcId, newFaction }[] }}
 */
export function onFamilyMemberKilled(db, killedNPCId, killerId, killerType, realtimeEmit) {
  const radicalized = [];

  try {
    const family = db.prepare(`
      SELECT r.npc_id, r.rel_type, r.strength
      FROM npc_relationships r
      WHERE r.related_id = ?
    `).all(killedNPCId);

    for (const bond of family) {
      const survivorId = bond.npc_id;
      const survivor   = db.prepare('SELECT * FROM world_npcs WHERE id = ? AND is_dead = 0').get(survivorId);
      if (!survivor) continue;

      // Grief impact scales by relationship strength
      const griefBase = bond.rel_type === 'sibling' || bond.rel_type === 'friend'
        ? GRIEF_PER_EXTENDED_DEATH
        : GRIEF_PER_FAMILY_DEATH;
      const griefGain = griefBase * (bond.strength ?? 1.0);

      const newGrief = Math.min(1.0, (survivor.grief_level ?? 0) + griefGain);
      db.prepare('UPDATE world_npcs SET grief_level = ? WHERE id = ?').run(newGrief, survivorId);

      logger.debug('npc-family', 'grief_update', {
        survivorId, killedNPCId, bond: bond.rel_type, newGrief,
      });

      // Radicalization threshold crossed
      if (newGrief >= RADICALIZATION_THRESHOLD && !survivor.radicalized) {
        const result = _radicalize(db, survivor, killedNPCId, killerId, killerType, realtimeEmit);
        if (result) radicalized.push(result);
      }
    }

    // Mark death record as family-notified
    db.prepare(
      'UPDATE npc_deaths SET notified_family = 1 WHERE npc_id = ? AND notified_family = 0'
    ).run(killedNPCId);
  } catch (e) {
    logger.debug('npc-family', 'grief_skip', { reason: e.message });
  }

  return { radicalized };
}

/**
 * Decay grief over time — call every simulator tick.
 * Grief heals slowly so NPCs don't stay radicalized forever if the cause stops.
 */
export function decayGrief(db, npcId) {
  try {
    db.prepare(`
      UPDATE world_npcs SET grief_level = MAX(0, grief_level - ?)
      WHERE id = ? AND grief_level > 0 AND radicalized = 0
    `).run(GRIEF_DECAY_PER_TICK, npcId);
  } catch { /* non-fatal */ }
}

// ── Crossbreeding ─────────────────────────────────────────────────────────────

/**
 * Check if two married NPCs should produce offspring this tick.
 * Called by NPCSimulator on social tick for spouse pairs.
 *
 * @returns {object|null}  new offspring NPC row data, or null
 */
export function attemptCrossbreed(db, npcIdA, npcIdB, worldId) {
  if (Math.random() > CROSSBREED_CHANCE) return null;

  const npcA = db.prepare('SELECT * FROM world_npcs WHERE id = ? AND is_dead = 0').get(npcIdA);
  const npcB = db.prepare('SELECT * FROM world_npcs WHERE id = ? AND is_dead = 0').get(npcIdB);
  if (!npcA || !npcB) return null;

  // Check family size limit
  const familySize = db.prepare(
    'SELECT COUNT(*) as n FROM npc_relationships WHERE npc_id = ? AND rel_type = "child"'
  ).get(npcIdA)?.n ?? 0;
  if (familySize >= MAX_FAMILY_SIZE) return null;

  return _spawnOffspring(db, npcA, npcB, worldId);
}

/**
 * Force a crossbreed — used by quest system or world events.
 */
export function forceCrossbreed(db, npcIdA, npcIdB, worldId) {
  const npcA = db.prepare('SELECT * FROM world_npcs WHERE id = ?').get(npcIdA);
  const npcB = db.prepare('SELECT * FROM world_npcs WHERE id = ?').get(npcIdB);
  if (!npcA || !npcB) return null;
  return _spawnOffspring(db, npcA, npcB, worldId);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _radicalize(db, survivor, killedId, killerId, killerType, realtimeEmit) {
  const originalFaction = survivor.faction || 'neutral';
  const newFaction = RADICALIZATION_FACTIONS[
    Math.floor(Math.random() * RADICALIZATION_FACTIONS.length)
  ];
  const reason = `family_killed_by_${killerType}:${killerId}`;

  db.prepare(`
    UPDATE world_npcs
    SET radicalized = 1, radicalized_reason = ?, original_faction = ?, faction = ?,
        grief_level = 1.0
    WHERE id = ?
  `).run(reason, originalFaction, newFaction, survivor.id);

  logger.info('npc-family', 'radicalized', {
    npcId: survivor.id, originalFaction, newFaction, reason,
  });

  realtimeEmit?.('world:npc-event', {
    worldId: survivor.world_id,
    type: 'radicalization',
    npcId: survivor.id,
    message: `${_npcName(survivor)} has turned against ${killerType === 'player' ? 'the players' : 'former allies'} after the death of a loved one.`,
    newFaction,
  });

  return { npcId: survivor.id, newFaction, originalFaction };
}

function _spawnOffspring(db, parentA, parentB, worldId) {
  const offspringId = crypto.randomUUID();

  const speciesA = parentA.species || 'human';
  const speciesB = parentB.species || 'human';
  const isMixed  = speciesA !== speciesB;
  const hybridSpecies = isMixed ? `hybrid:${[speciesA, speciesB].sort().join('/')}` : speciesA;

  // Blend traits
  const traitsA   = _parseJSON(parentA.inherited_traits, {});
  const traitsB   = _parseJSON(parentB.inherited_traits, {});
  const bodyA     = SPECIES_BODY[speciesA] ?? SPECIES_BODY.human;
  const bodyB     = SPECIES_BODY[speciesB] ?? SPECIES_BODY.human;

  const hybridTraits = {
    scale:  ((bodyA.scale + bodyB.scale) / 2).toFixed(2),
    wings:  bodyA.wings || bodyB.wings,
    tail:   bodyA.tail  || bodyB.tail,
    horns:  bodyA.horns || bodyB.horns,
    parentSpecies: [speciesA, speciesB],
  };

  // Dominant parent (higher level) passes archetype
  const dominant    = (parentA.level || 1) >= (parentB.level || 1) ? parentA : parentB;
  const recessive   = dominant === parentA ? parentB : parentA;
  const archetype   = dominant.archetype || 'generic';

  // Body type from scale
  const scale = parseFloat(hybridTraits.scale);
  const bodyType = scale > 2.0 ? 'giant' : scale > 1.3 ? 'large' : scale < 0.8 ? 'small' : 'humanoid';

  // Faction from dominant parent's social bond strength (or dominant parent's faction)
  const faction = dominant.faction || 'neutral';

  // Level = average of parents + generational bonus
  const parentGen  = Math.max(parentA.generation ?? 0, parentB.generation ?? 0);
  const level      = Math.max(1, Math.floor(((parentA.level || 1) + (parentB.level || 1)) / 2));

  const spawnPos = _parseJSON(parentA.current_location, { x: 0, y: 0, z: 0 });

  try {
    db.prepare(`
      INSERT INTO world_npcs
        (id, world_id, npc_type, archetype, body_type, species, parent_ids, inherited_traits,
         generation, spawn_method, faction, level, spawn_location, current_location, state,
         is_conscious, is_immortal, quest_giver)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0)
    `).run(
      offspringId, worldId,
      archetype, archetype, bodyType,
      hybridSpecies,
      JSON.stringify([parentA.id, parentB.id]),
      JSON.stringify(hybridTraits),
      parentGen + 1,
      'crossbreed',
      faction, level,
      JSON.stringify(spawnPos),
      JSON.stringify(spawnPos),
      JSON.stringify({
        name: `${_npcName(dominant)}'s offspring`,
        isOffspring: true,
        hybridTraits,
      }),
    );

    // Create family bonds
    addFamilyBond(db, parentA.id, offspringId, 'child');
    addFamilyBond(db, parentB.id, offspringId, 'child');
    // Siblings — find other children of parentA
    const siblings = db.prepare(
      'SELECT related_id FROM npc_relationships WHERE npc_id = ? AND rel_type = "child"'
    ).all(parentA.id).map(r => r.related_id).filter(id => id !== offspringId);
    for (const sibId of siblings) addFamilyBond(db, offspringId, sibId, 'sibling');

    logger.info('npc-family', 'crossbreed_spawned', {
      offspringId, parentA: parentA.id, parentB: parentB.id,
      species: hybridSpecies, archetype, level,
      wings: hybridTraits.wings, tail: hybridTraits.tail, horns: hybridTraits.horns,
    });

    return {
      id: offspringId, species: hybridSpecies, archetype, bodyType,
      faction, level, hybridTraits, parentIds: [parentA.id, parentB.id],
    };
  } catch (e) {
    logger.debug('npc-family', 'crossbreed_fail', { reason: e.message });
    return null;
  }
}

function _npcName(npc) {
  const state = _parseJSON(npc.state, {});
  return state.name || npc.archetype || `NPC-${npc.id.slice(0, 6)}`;
}

function _parseJSON(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}
