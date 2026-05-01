// server/lib/npc-relations.js
// NPC social reputation system. NPCs and emergents have real opinions about players
// and each other. Actions in the world shift these in real-time.

import crypto from 'node:crypto';
import logger from '../logger.js';

// ── Opinion change magnitudes ──────────────────────────────────────────────────
// Positive actions
const POSITIVE_EVENTS = {
  helped_npc:           0.08,   // assisted an NPC with a task
  bought_from_npc:      0.03,   // commerce builds goodwill
  gave_gift:            0.12,
  defended_npc:         0.20,   // protected an NPC from attack
  completed_quest:      0.25,
  complimented:         0.04,
  shared_resources:     0.06,
  spoke_kindly:         0.02,
  paid_bounty:          0.15,   // cleared your criminal record
};

// Negative actions (magnitudes — applied as negative)
const NEGATIVE_EVENTS = {
  attacked_bystander:   0.40,   // massive hit — everyone nearby sees
  stole_from_npc:       0.30,
  broke_into_building:  0.25,
  insulted:             0.08,
  threatened:           0.15,
  destroyed_property:   0.20,
  killed_civilian:      0.80,   // near-permanent
  murdered_npc:         1.00,   // faction will never forgive
  refused_plea:         0.05,
  lied_when_known:      0.10,
  disturbed_sleep:      0.06,
};

// How far opinion spreads from the direct observer (social network decay)
const WITNESS_DECAY = 0.4;  // witness opinions propagate at 40% strength
const FACTION_DECAY  = 0.2;  // faction-wide opinion at 20% strength

// ── Migration helper (called from migration 065 or a new one) ─────────────────
export function ensureRelationsTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_opinions (
      id           TEXT PRIMARY KEY,
      subject_id   TEXT NOT NULL,   -- the NPC/emergent who holds this opinion
      subject_type TEXT NOT NULL DEFAULT 'npc',
      target_id    TEXT NOT NULL,   -- player or NPC being evaluated
      target_type  TEXT NOT NULL DEFAULT 'player',
      opinion      REAL NOT NULL DEFAULT 0,  -- -1.0 (hate) to +1.0 (love)
      respect      REAL NOT NULL DEFAULT 0,  -- separate: do they respect skill/power?
      fear         REAL NOT NULL DEFAULT 0,  -- 0-1: are they afraid?
      trust        REAL NOT NULL DEFAULT 0,  -- 0-1: do they trust?
      last_event   TEXT,            -- description of the last thing that changed opinion
      last_updated INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(subject_id, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_opinions_subject ON npc_opinions(subject_id);
    CREATE INDEX IF NOT EXISTS idx_opinions_target  ON npc_opinions(target_id);

    CREATE TABLE IF NOT EXISTS opinion_events (
      id           TEXT PRIMARY KEY,
      world_id     TEXT NOT NULL,
      actor_id     TEXT NOT NULL,
      actor_type   TEXT NOT NULL DEFAULT 'player',
      event_type   TEXT NOT NULL,
      magnitude    REAL NOT NULL,
      location_x   REAL,
      location_z   REAL,
      witness_radius REAL DEFAULT 30,
      context      TEXT,
      occurred_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_opinion_events_world ON opinion_events(world_id, occurred_at DESC);
  `);
}

// ── Core opinion manipulation ──────────────────────────────────────────────────

/**
 * Get or create an opinion record between subject and target.
 */
export function getOpinion(db, subjectId, subjectType, targetId, targetType = 'player') {
  const row = db.prepare('SELECT * FROM npc_opinions WHERE subject_id = ? AND target_id = ?').get(subjectId, targetId);
  if (row) return row;
  // Default opinion — slightly positive for civilians, neutral for guards
  const defaultOpinion = 0.1;
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT OR IGNORE INTO npc_opinions (id, subject_id, subject_type, target_id, target_type, opinion, last_updated)
    VALUES (?,?,?,?,?,?,?)`)
    .run(id, subjectId, subjectType, targetId, targetType, defaultOpinion, now);
  return { id, subject_id: subjectId, subject_type: subjectType, target_id: targetId, target_type: targetType, opinion: defaultOpinion, respect: 0, fear: 0, trust: 0 };
}

/**
 * Adjust an NPC's opinion of an actor by delta.
 * Clamps to [-1, 1]. Updates respect/fear based on event type.
 */
function _shiftOpinion(db, subjectId, subjectType, targetId, targetType, delta, eventDescription, opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO npc_opinions (id, subject_id, subject_type, target_id, target_type, opinion, last_event, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(subject_id, target_id) DO UPDATE SET
      opinion    = MAX(-1.0, MIN(1.0, opinion + ?)),
      respect    = MAX(0, MIN(1.0, respect + COALESCE(?, 0))),
      fear       = MAX(0, MIN(1.0, fear + COALESCE(?, 0))),
      trust      = MAX(0, MIN(1.0, trust + COALESCE(?, 0))),
      last_event = ?,
      last_updated = ?
  `).run(
    crypto.randomUUID(), subjectId, subjectType, targetId, targetType,
    Math.max(-1, Math.min(1, delta)), eventDescription, now,
    // ON CONFLICT updates:
    delta,
    opts.respectDelta ?? 0,
    opts.fearDelta ?? 0,
    opts.trustDelta ?? 0,
    eventDescription, now,
  );
}

/**
 * Broadcast a world event that shifts opinions of all nearby NPCs.
 * @param {object} db
 * @param {string} worldId
 * @param {string} actorId     — the player or NPC who did the thing
 * @param {'player'|'npc'} actorType
 * @param {string} eventType   — key from POSITIVE_EVENTS or NEGATIVE_EVENTS
 * @param {{ x: number, z: number }} location
 * @param {{ radius?: number, targetId?: string, context?: string }} opts
 */
export function broadcastOpinionEvent(db, worldId, actorId, actorType, eventType, location, opts = {}) {
  const radius = opts.radius ?? 30;
  const magnitude = POSITIVE_EVENTS[eventType] ?? -(NEGATIVE_EVENTS[eventType] ?? 0);

  if (magnitude === 0) {
    logger.debug('npc-relations', 'unknown_event_type', { eventType });
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  // Log the event
  const eventId = crypto.randomUUID();
  try {
    db.prepare(`INSERT INTO opinion_events (id, world_id, actor_id, actor_type, event_type, magnitude, location_x, location_z, witness_radius, context)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(eventId, worldId, actorId, actorType, eventType, magnitude,
           location?.x ?? null, location?.z ?? null, radius, opts.context ?? null);
  } catch { /* table may not exist — ensure called after migration */ }

  // Find all NPCs within radius who witness this
  const witnesses = db.prepare(`
    SELECT id, archetype, faction, is_conscious FROM world_npcs
    WHERE world_id = ? AND is_dead = 0
      AND ABS(CAST(json_extract(location, '$.x') AS REAL) - ?) <= ?
      AND ABS(CAST(json_extract(location, '$.z') AS REAL) - ?) <= ?
    LIMIT 30
  `).all(worldId, location?.x ?? 0, radius, location?.z ?? 0, radius);

  const directWitnesses = new Set(witnesses.map(w => w.id));

  // Direct witnesses get full magnitude
  for (const witness of witnesses) {
    const respDelta = magnitude < 0 ? 0 : magnitude * 0.1;
    const fearDelta = magnitude < -0.3 ? Math.abs(magnitude) * 0.2 : 0;
    const trustDelta = magnitude > 0.1 ? magnitude * 0.1 : magnitude < -0.2 ? magnitude * 0.1 : 0;
    const desc = `Witnessed ${eventType} by ${actorId.slice(0, 8)}`;

    _shiftOpinion(db, witness.id, 'npc', actorId, actorType, magnitude, desc,
      { respectDelta: respDelta, fearDelta: fearDelta, trustDelta: trustDelta });
  }

  // Faction-wide spread (reduced magnitude) — NPCs gossip
  if (Math.abs(magnitude) >= 0.2 && witnesses.length > 0) {
    const factions = [...new Set(witnesses.map(w => w.faction).filter(Boolean))];
    for (const faction of factions) {
      const factionMembers = db.prepare(`
        SELECT id FROM world_npcs WHERE world_id = ? AND faction = ? AND is_dead = 0 LIMIT 20
      `).all(worldId, faction);

      for (const member of factionMembers) {
        if (directWitnesses.has(member.id)) continue; // already updated
        const spreadMagnitude = magnitude * FACTION_DECAY;
        _shiftOpinion(db, member.id, 'npc', actorId, actorType, spreadMagnitude,
          `Heard about ${eventType} from faction members`, {});
      }
    }
  }

  // Specific target opinion also shifts (the NPC who was directly affected)
  if (opts.targetId) {
    _shiftOpinion(db, opts.targetId, 'npc', actorId, actorType,
      magnitude * 1.5, // direct target feels it more
      `Direct target of ${eventType}`,
      { fearDelta: magnitude < -0.3 ? 0.3 : 0 });
  }

  logger.debug('npc-relations', 'opinion_broadcast', {
    eventType, actorId, magnitude, witnesses: witnesses.length,
  });
}

/**
 * Get a summary of how an actor is perceived in a world.
 * Returns reputation tier: 'beloved'|'liked'|'neutral'|'disliked'|'hated'|'feared'
 */
export function getWorldReputation(db, worldId, actorId) {
  const opinions = db.prepare(`
    SELECT AVG(opinion) as avg_opinion, AVG(fear) as avg_fear, AVG(trust) as avg_trust, COUNT(*) as n
    FROM npc_opinions
    WHERE target_id = ?
      AND subject_id IN (SELECT id FROM world_npcs WHERE world_id = ? AND is_dead = 0)
  `).get(worldId, actorId);

  const avg = opinions?.avg_opinion ?? 0;
  const fear = opinions?.avg_fear ?? 0;
  const n = opinions?.n ?? 0;

  let tier;
  if (avg >= 0.6) tier = 'beloved';
  else if (avg >= 0.3) tier = 'liked';
  else if (avg >= -0.1) tier = 'neutral';
  else if (avg >= -0.4) tier = 'disliked';
  else if (avg >= -0.7) tier = 'hated';
  else tier = 'enemy';

  // High fear overrides if very low opinion
  if (fear > 0.6 && avg < 0) tier = 'feared';

  return { tier, avg_opinion: avg, avg_fear: fear, avg_trust: opinions?.avg_trust ?? 0, sample_size: n };
}

/**
 * Check if an NPC will interact with/for the actor based on current opinion.
 * Returns { willing, mood, greeting }
 */
export function willNPCInteract(db, npcId, actorId, interactionType = 'talk') {
  const opinion = getOpinion(db, npcId, 'npc', actorId, 'player');
  const op = opinion.opinion ?? 0;
  const fear = opinion.fear ?? 0;

  // Different interactions need different opinion thresholds
  const thresholds = {
    talk:    -0.5,   // will talk to anyone they don't hate
    trade:   -0.2,   // won't trade with disliked actors
    quest:    0.3,   // only give quests to liked actors
    help:     0.4,
    alliance: 0.6,
  };

  const threshold = thresholds[interactionType] ?? -0.3;
  const willing = op >= threshold;

  // Mood colors the interaction tone
  let mood;
  if (fear > 0.6) mood = 'fearful';
  else if (op >= 0.5) mood = 'warm';
  else if (op >= 0.2) mood = 'friendly';
  else if (op >= -0.1) mood = 'neutral';
  else if (op >= -0.4) mood = 'cold';
  else mood = 'hostile';

  // Greeting varies by mood
  const greetings = {
    fearful:  ["P-please don't hurt me...", "What do you want from me?"],
    warm:     ["Wonderful to see you!", "Ah, my favorite visitor!"],
    friendly: ["Good to see you.", "How can I help?"],
    neutral:  ["What do you need?", "Mmhm."],
    cold:     ["...What.", "Make it quick."],
    hostile:  ["Get away from me.", "I have nothing to say to you."],
  };

  const pool = greetings[mood] || greetings.neutral;
  const greeting = pool[Math.floor(Math.random() * pool.length)];

  return { willing, mood, greeting, opinion: op, fear };
}

/**
 * Get the top-N most/least liked actors from an NPC's perspective.
 */
export function getNPCRelationshipSummary(db, npcId, limit = 5) {
  const liked = db.prepare(`
    SELECT target_id, target_type, opinion, trust, last_event
    FROM npc_opinions WHERE subject_id = ? ORDER BY opinion DESC LIMIT ?
  `).all(npcId, limit);

  const disliked = db.prepare(`
    SELECT target_id, target_type, opinion, fear, last_event
    FROM npc_opinions WHERE subject_id = ? ORDER BY opinion ASC LIMIT ?
  `).all(npcId, limit);

  return { liked, disliked };
}
