// @sql-loop-ok: iterates open crimes with conditional UPDATE — easier to leave as-is than batch
// server/lib/world-crime.js
// Break-in detection, access control, evidence generation, and detective AI.
// Both players AND NPCs can be criminals. Both can be victims.

import crypto from 'node:crypto';
import logger from '../logger.js';

// ── Evidence decay rates (seconds) ────────────────────────────────────────────
const EVIDENCE_DECAY = {
  footprint:           3600 * 6,   // 6h — fade quickly
  broken_lock:         3600 * 72,  // 3 days — physical, lasts longer
  blood:               3600 * 48,  // 2 days
  magical_residue:     3600 * 24,  // 1 day — magic dissipates
  stolen_item_trace:   3600 * 12,  // 12h — paper trail fades
  witness_account:     3600 * 96,  // 4 days — witnesses remember
  item_left_behind:    null,        // permanent — criminal dropped something
};

// ── Access control ────────────────────────────────────────────────────────────

/**
 * Check if an entity (player or NPC) can enter a room without committing a crime.
 * @param {object} db
 * @param {string} roomId
 * @param {string} entityId
 * @param {'player'|'npc'} entityType
 * @returns {{ allowed: boolean, reason?: string, requiresLockpick?: boolean, lockTier?: number }}
 */
export function checkRoomAccess(db, roomId, entityId, entityType) {
  // TODO: project explicit columns (auto-fix suggestion)
  const room = db.prepare('SELECT * FROM building_rooms WHERE id = ?').get(roomId);
  if (!room) return { allowed: false, reason: 'room_not_found' };

  // Public rooms are open to all
  if (room.is_public) return { allowed: true };

  // Owner always has access
  if (room.owner_id === entityId) return { allowed: true };

  // Check if building owner
  const building = db.prepare('SELECT owner_id, owner_type FROM world_buildings WHERE id = ?').get(room.building_id);
  if (building?.owner_id === entityId) return { allowed: true };

  // Locked room — needs lockpick or force
  if (room.lock_tier > 0 && room.lock_state === 'locked') {
    return { allowed: false, reason: 'locked', requiresLockpick: true, lockTier: room.lock_tier };
  }

  // Private but unlocked — trespassing if entered
  return { allowed: false, reason: 'private', requiresLockpick: false, lockTier: 0 };
}

/**
 * Attempt to lockpick a room. Skill check: lockpick_skill vs lock_tier.
 * @param {object} db
 * @param {string} roomId
 * @param {string} entityId
 * @param {'player'|'npc'} entityType
 * @param {number} lockpickSkill  0–100
 * @returns {{ success: boolean, crimeEventId?: string, partial?: boolean }}
 */
export function attemptLockpick(db, roomId, entityId, entityType, lockpickSkill = 1) {
  // TODO: project explicit columns (auto-fix suggestion)
  const room = db.prepare('SELECT * FROM building_rooms WHERE id = ?').get(roomId);
  if (!room) return { success: false };

  const lockTier = room.lock_tier || 1;
  // Success chance: skill / (lockTier × 20) — tier 5 needs skill 100 for 100% chance
  const chance = Math.min(0.95, lockpickSkill / (lockTier * 20));
  const success = Math.random() < chance;

  // Every attempt creates noise evidence (even failed ones sometimes)
  const noisy = !success || Math.random() < 0.3;

  if (success) {
    db.prepare('UPDATE building_rooms SET lock_state = ?, last_breach = ? WHERE id = ?')
      .run('picked', Math.floor(Date.now() / 1000), roomId);
  }

  // Create crime event for the attempt
  const crimeEventId = _createCrimeEvent(db, {
    worldId: _getRoomWorldId(db, roomId),
    crimeType: success ? 'break_in' : 'trespass',
    locationId: roomId,
    locationType: 'room',
    criminalId: entityId,
    criminalType: entityType,
    victimId: room.owner_id,
    victimType: 'player',
  });

  if (crimeEventId) {
    // Generate evidence
    _addEvidence(db, crimeEventId, _getRoomWorldId(db, roomId), 'footprint',
      `Scratches near lock of ${room.name || room.room_type}`, entityId, entityType, 0.15);
    if (noisy) {
      _addEvidence(db, crimeEventId, _getRoomWorldId(db, roomId), 'broken_lock',
        `Lock on ${room.name || room.room_type} shows pick marks — ${success ? 'successfully picked' : 'damaged but held'}`,
        entityId, entityType, 0.25);
    }
    // Check for witnesses (other NPCs in same building)
    _detectWitnesses(db, crimeEventId, room.building_id, _getRoomWorldId(db, roomId));
  }

  logger.debug('world-crime', 'lockpick_attempt', { roomId, entityId, success, lockTier });
  return { success, crimeEventId, noisy };
}

/**
 * Force entry by destroying a door/lock (loud, obvious, high evidence).
 */
export function forceEntry(db, roomId, entityId, entityType) {
  // TODO: project explicit columns (auto-fix suggestion)
  const room = db.prepare('SELECT * FROM building_rooms WHERE id = ?').get(roomId);
  if (!room) return { ok: false };

  db.prepare('UPDATE building_rooms SET lock_state = ?, last_breach = ? WHERE id = ?')
    .run('broken', Math.floor(Date.now() / 1000), roomId);

  const worldId = _getRoomWorldId(db, roomId);
  const crimeEventId = _createCrimeEvent(db, {
    worldId,
    crimeType: 'break_in',
    locationId: roomId,
    locationType: 'room',
    criminalId: entityId,
    criminalType: entityType,
    victimId: room.owner_id,
    victimType: 'player',
  });

  if (crimeEventId) {
    // Forced entry leaves massive evidence
    _addEvidence(db, crimeEventId, worldId, 'broken_lock',
      `Door to ${room.name || room.room_type} violently forced — frame splintered`, entityId, entityType, 0.4);
    _addEvidence(db, crimeEventId, worldId, 'footprint',
      'Heavy boot prints leading away from forced door', entityId, entityType, 0.2);
    _detectWitnesses(db, crimeEventId, room.building_id, worldId);

    // Alert nearby guard NPCs immediately
    _alertGuards(db, worldId, crimeEventId, room.building_id);
  }

  return { ok: true, crimeEventId };
}

/**
 * Record a theft from a room (items taken from chests, shelves, etc.).
 */
export function recordTheft(db, roomId, thievingEntityId, entityType, stolenItems = []) {
  // TODO: project explicit columns (auto-fix suggestion)
  const room = db.prepare('SELECT * FROM building_rooms WHERE id = ?').get(roomId);
  if (!room) return null;

  const worldId = _getRoomWorldId(db, roomId);
  const crimeEventId = _createCrimeEvent(db, {
    worldId,
    crimeType: 'theft',
    locationId: roomId,
    locationType: 'room',
    criminalId: thievingEntityId,
    criminalType: entityType,
    victimId: room.owner_id,
    victimType: room.owner_id ? 'player' : 'world',
    stolenItems,
  });

  if (crimeEventId) {
    // Stolen items leave a trace in evidence
    for (const item of stolenItems) {
      _addEvidence(db, crimeEventId, worldId, 'stolen_item_trace',
        `${item.item_name || item.item_id} × ${item.quantity} taken from ${room.name || room.room_type}`,
        thievingEntityId, entityType, 0.1);
    }
    // Fingerprints / magical residue if caster
    _addEvidence(db, crimeEventId, worldId, 'footprint',
      'Disturbed dust and moved containers indicate recent search', thievingEntityId, entityType, 0.12);
  }

  // Increase criminal reputation
  _increaseCriminalRep(db, thievingEntityId, entityType, 0.05);

  logger.debug('world-crime', 'theft_recorded', { roomId, thievingEntityId, itemCount: stolenItems.length });
  return crimeEventId;
}

/**
 * NPC breaks into a player or NPC home (criminal NPC behavior).
 * Returns the crime event id and list of items stolen from inventory/room.
 */
export function npcBreakIn(db, npcId, targetBuildingId, worldId) {
  // TODO: project explicit columns (auto-fix suggestion)
  const building = db.prepare('SELECT * FROM world_buildings WHERE id = ?').get(targetBuildingId);
  if (!building) return null;

  // TODO: project explicit columns (auto-fix suggestion)

  const npc = db.prepare('SELECT * FROM world_npcs WHERE id = ?').get(npcId);
  if (!npc) return null;

  // Pick the weakest lock in the building
  // TODO: project explicit columns (auto-fix suggestion)
  const rooms = db.prepare('SELECT * FROM building_rooms WHERE building_id = ? ORDER BY lock_tier ASC').all(targetBuildingId);
  const targetRoom = rooms.find(r => !r.is_public && r.lock_state === 'locked') || rooms.find(r => !r.is_public);
  if (!targetRoom) return null;

  // Attempt lockpick based on NPC criminal_rep
  const lockpickSkill = Math.min(80, (npc.criminal_rep || 0) * 60 + (npc.level || 1) * 3);
  const { success, crimeEventId } = attemptLockpick(db, targetRoom.id, npcId, 'npc', lockpickSkill);

  if (!success) return { success: false, crimeEventId };

  // Steal items from room's furniture (chests, etc.)
  const furniture = JSON.parse(targetRoom.furniture || '[]');
  const stolenItems = [];
  for (const item of furniture) {
    if (item.type === 'chest' && item.contents?.length) {
      const toSteal = item.contents.slice(0, Math.ceil(item.contents.length / 2));
      stolenItems.push(...toSteal);
    }
  }

  if (stolenItems.length > 0) {
    recordTheft(db, targetRoom.id, npcId, 'npc', stolenItems);
    // Add stolen items to NPC inventory (activity_resources)
    try {
      const resources = JSON.parse(
        db.prepare('SELECT activity_resources FROM world_npcs WHERE id = ?').get(npcId)?.activity_resources || '{}'
      );
      for (const item of stolenItems) {
        resources[item.item_id] = (resources[item.item_id] || 0) + (item.quantity || 1);
      }
      db.prepare('UPDATE world_npcs SET activity_resources = ?, criminal_rep = MIN(1.0, criminal_rep + 0.08) WHERE id = ?')
        .run(JSON.stringify(resources), npcId);
    } catch { /* non-fatal */ }
  }

  return { success: true, crimeEventId, stolenItems };
}

// ── Detective AI ───────────────────────────────────────────────────────────────

/**
 * Detective NPC investigates open crime events in their world.
 * Called from npc-simulator tick when NPC has job_type='detective' or archetype in ['guard','detective'].
 * @returns {{ investigated: number, solved: number, warrantIssued: boolean }}
 */
export function detectiveTick(db, npcId, worldId) {
  const now = Math.floor(Date.now() / 1000);

  // Find open crimes this detective is assigned to OR unassigned crimes
  const crimes = db.prepare(`
    SELECT * FROM crime_events
    WHERE world_id = ? AND status = 'open'
      AND (detective_id = ? OR detective_id IS NULL)
    ORDER BY occurred_at DESC LIMIT 5
  `).all(worldId, npcId);

  let investigated = 0, solved = 0, warrantIssued = false;

  for (const crime of crimes) {
    // Assign detective if not assigned
    if (!crime.detective_id) {
      db.prepare('UPDATE crime_events SET detective_id = ? WHERE id = ?').run(npcId, crime.id);
    }

    // Collect uncollected evidence
    const uncollected = db.prepare(`
      SELECT * FROM evidence_items
      WHERE crime_event_id = ? AND collected_by IS NULL
        AND (decay_at IS NULL OR decay_at > ?)
    `).all(crime.id, now);

    let confidenceGain = 0;
    let primarySuspect = crime.criminal_id;

    for (const ev of uncollected) {
      // Mark evidence as collected
      db.prepare('UPDATE evidence_items SET collected_by = ?, collected_at = ? WHERE id = ?')
        .run(npcId, now, ev.id);
      confidenceGain += ev.confidence_boost || 0.1;
      if (ev.links_to_id) primarySuspect = ev.links_to_id;
    }

    // Check witness accounts
    const witnesses = JSON.parse(crime.witnesses || '[]');
    if (witnesses.length > 0 && !primarySuspect) {
      // Witnesses can identify the criminal if they saw them
      // TODO: project explicit columns (auto-fix suggestion)
      const witness = db.prepare('SELECT * FROM world_npcs WHERE id = ?').get(witnesses[0]);
      if (witness) {
        // Ask witness: if criminal was seen, high confidence
        confidenceGain += 0.3;
        // Generate a witness account evidence item
        const witnessEvId = crypto.randomUUID();
        db.prepare(`INSERT OR IGNORE INTO evidence_items
          (id, crime_event_id, world_id, evidence_type, description, confidence_boost, collected_by, collected_at)
          VALUES (?,?,?,?,?,?,?,?)`)
          .run(witnessEvId, crime.id, worldId, 'witness_account',
            `Witness ${witness.state ? JSON.parse(witness.state).name : witness.id} reports seeing a suspicious figure`,
            0.25, npcId, now);
      }
    }

    // Update crime confidence
    const newConfidence = Math.min(1.0, (crime.confidence || 0) + confidenceGain);
    const suspects = primarySuspect
      ? JSON.stringify([...(JSON.parse(crime.suspect_ids || '[]')), primarySuspect].filter((v, i, a) => a.indexOf(v) === i))
      : crime.suspect_ids;

    db.prepare(`UPDATE crime_events SET confidence = ?, suspect_ids = ?, criminal_id = COALESCE(criminal_id, ?)
      WHERE id = ?`)
      .run(newConfidence, suspects, primarySuspect || null, crime.id);

    investigated++;

    // Solved: confidence high enough + have a suspect
    if (newConfidence >= 0.7 && primarySuspect) {
      const reportText = _generateDetectiveReport(crime, primarySuspect, newConfidence, uncollected);
      db.prepare(`UPDATE crime_events SET status = 'solved', criminal_id = ?, confidence = ?, report_text = ?, resolved_at = ? WHERE id = ?`)
        .run(primarySuspect, newConfidence, reportText, now, crime.id);

      // Issue arrest warrant
      const warrantId = crypto.randomUUID();
      const bounty = _computeBounty(crime.crime_type);
      db.prepare(`INSERT OR IGNORE INTO arrest_records (id, world_id, suspect_id, suspect_type, crime_event_id, issuing_detective, bounty_amount)
        VALUES (?,?,?,?,?,?,?)`)
        .run(warrantId, worldId, primarySuspect, crime.criminal_type || 'player', crime.id, npcId, bounty);

      // Mark suspect as wanted
      if (crime.criminal_type === 'npc') {
        db.prepare('UPDATE world_npcs SET is_wanted = 1, bounty = bounty + ? WHERE id = ?')
          .run(bounty, primarySuspect);
      }

      solved++;
      warrantIssued = true;
      logger.debug('world-crime', 'crime_solved', { crimeId: crime.id, suspect: primarySuspect, confidence: newConfidence });
    }
  }

  return { investigated, solved, warrantIssued };
}

/**
 * Guard NPC patrols and responds to recent crime events / wanted NPCs.
 */
export function guardTick(db, npcId, worldId, npcLocation) {
  const now = Math.floor(Date.now() / 1000);

  // Check for wanted NPCs nearby
  const wantedNearby = db.prepare(`
    SELECT n.id, n.level, n.archetype, n.bounty, n.state
    FROM world_npcs n
    WHERE n.world_id = ? AND n.is_wanted = 1 AND n.is_dead = 0
    LIMIT 3
  `).all(worldId);

  // Check recent crimes in nearby buildings (within last hour)
  const recentCrimes = db.prepare(`
    SELECT * FROM crime_events
    WHERE world_id = ? AND status = 'open' AND occurred_at > ?
    ORDER BY occurred_at DESC LIMIT 3
  `).all(worldId, now - 3600);

  return { wantedNearby, recentCrimes, onPatrol: true };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _createCrimeEvent(db, { worldId, crimeType, locationId, locationType, criminalId, criminalType, victimId, victimType, stolenItems = [] }) {
  if (!worldId) return null;
  const id = crypto.randomUUID();
  try {
    db.prepare(`
      INSERT INTO crime_events
        (id, world_id, crime_type, location_id, location_type, criminal_id, criminal_type, victim_id, victim_type, stolen_items)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(id, worldId, crimeType, locationId, locationType, criminalId || null, criminalType || null,
        victimId || null, victimType || null, JSON.stringify(stolenItems));
    return id;
  } catch (e) {
    logger.debug('world-crime', 'create_crime_event_failed', { error: e.message });
    return null;
  }
}

function _addEvidence(db, crimeEventId, worldId, evidenceType, description, linksToId, linksToType, confidenceBoost) {
  const now = Math.floor(Date.now() / 1000);
  const decaySeconds = EVIDENCE_DECAY[evidenceType];
  const decayAt = decaySeconds ? now + decaySeconds : null;
  try {
    db.prepare(`
      INSERT INTO evidence_items (id, crime_event_id, world_id, evidence_type, description, links_to_id, links_to_type, confidence_boost, decay_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(crypto.randomUUID(), crimeEventId, worldId, evidenceType, description,
        linksToId || null, linksToType || null, confidenceBoost, decayAt);
  } catch { /* non-fatal */ }
}

function _detectWitnesses(db, crimeEventId, buildingId, worldId) {
  // Find NPCs in the same building who might have witnessed
  try {
    const npcsNear = db.prepare(`
      SELECT id FROM world_npcs
      WHERE world_id = ? AND is_dead = 0 AND job_location_id = ?
      LIMIT 5
    `).all(worldId, buildingId);

    if (npcsNear.length > 0) {
      const witnessIds = npcsNear.map(n => n.id);
      db.prepare('UPDATE crime_events SET witnesses = ? WHERE id = ?')
        .run(JSON.stringify(witnessIds), crimeEventId);
      // High visibility = add witness evidence immediately
      if (npcsNear.length >= 2) {
        _addEvidence(db, crimeEventId, worldId, 'witness_account',
          `${npcsNear.length} potential witnesses present in building`, null, null, 0.15 * npcsNear.length);
      }
    }
  } catch { /* non-fatal */ }
}

function _alertGuards(db, worldId, crimeEventId, buildingId) {
  // Assign the crime to any available detective/guard
  try {
    const detective = db.prepare(`
      SELECT id FROM world_npcs
      WHERE world_id = ? AND is_dead = 0 AND (archetype = 'guard' OR archetype = 'detective' OR job_type = 'detective')
      LIMIT 1
    `).get(worldId);
    if (detective) {
      db.prepare('UPDATE crime_events SET detective_id = ? WHERE id = ?').run(detective.id, crimeEventId);
    }
  } catch { /* non-fatal */ }
}

function _increaseCriminalRep(db, entityId, entityType, delta) {
  if (entityType !== 'npc') return;
  try {
    db.prepare('UPDATE world_npcs SET criminal_rep = MIN(1.0, criminal_rep + ?) WHERE id = ?')
      .run(delta, entityId);
  } catch { /* non-fatal */ }
}

function _getRoomWorldId(db, roomId) {
  try {
    return db.prepare('SELECT world_id FROM building_rooms WHERE id = ?').get(roomId)?.world_id;
  } catch { return null; }
}

function _computeBounty(crimeType) {
  const BOUNTIES = { break_in: 50, theft: 100, assault: 200, murder: 500, vandalism: 30, trespass: 10 };
  return BOUNTIES[crimeType] || 25;
}

function _generateDetectiveReport(crime, suspectId, confidence, evidence) {
  const evidenceList = evidence.map(e => `- ${e.description}`).join('\n');
  return `CASE REPORT — ${crime.crime_type.toUpperCase()}
Location: ${crime.location_id}
Occurred: ${new Date(crime.occurred_at * 1000).toISOString()}
Suspect: ${suspectId}
Confidence: ${Math.round(confidence * 100)}%

Evidence collected:
${evidenceList || '(none additional)'}

RECOMMENDATION: ${confidence >= 0.9 ? 'Arrest immediately' : confidence >= 0.7 ? 'Issue warrant, continue investigation' : 'Inconclusive — continue gathering evidence'}`;
}

// ── Public access check for API ───────────────────────────────────────────────

/**
 * Get all open crimes in a world for UI display.
 */
export function getOpenCrimes(db, worldId, limit = 20) {
  return db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM evidence_items e WHERE e.crime_event_id = c.id) as evidence_count
    FROM crime_events c
    WHERE c.world_id = ? AND c.status = 'open'
    ORDER BY c.occurred_at DESC LIMIT ?
  `).all(worldId, limit);
}

/**
 * Get active warrants/bounties in a world.
 */
export function getActiveWarrants(db, worldId) {
  return db.prepare(`
    SELECT a.*, c.crime_type, c.report_text
    FROM arrest_records a
    JOIN crime_events c ON c.id = a.crime_event_id
    WHERE a.world_id = ? AND a.status = 'active'
    ORDER BY a.bounty_amount DESC
  `).all(worldId);
}
