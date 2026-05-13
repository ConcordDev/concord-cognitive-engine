// server/lib/npc-ambition.js
//
// Phase T — NPC ambition + cross-world goal-seeking.
//
// An NPC's ambition_score (0..1, on world_npcs row) drives how
// aggressively it pursues unilateral high-stakes moves:
//   * skill-grind cross-world travel
//   * assassination of rival NPCs
//   * marketplace arbitrage tours
//   * kingdom takeover attempts
//   * quest pursuit
//
// API:
//   chooseTravelGoal(npc, db)   — returns a travel intent or null
//   queueIntent(db, intent)     — INSERTs into npc_travel_intents
//   getOpenIntent(db, npcId)    — returns active pending intent if any
//   pickAmbitionMove(npc, db)   — picks one of {assassinate, kingdom-bid, learn}
//   recordAmbitionMove(db, ...) — appends npc_ambition_log row
//
// Deterministic per (npcId + ISO day-bucket): same NPC on same day
// always picks the same move so the world reads consistent across
// re-renders.

import crypto from 'node:crypto';

const TRAVEL_REASONS = ['skill_grind', 'quest_pursuit', 'assassination_target', 'marketplace_arbitrage', 'kingdom_target', 'curiosity'];

function _seededRand(seedStr) {
  const h = crypto.createHash('sha1').update(seedStr).digest();
  return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}
function _seededFloat(seedStr) { return (_seededRand(seedStr) % 1_000_000) / 1_000_000; }
function _seededPick(arr, seedStr) { return arr[_seededRand(seedStr) % arr.length]; }

/** Look at the NPC's home_world_id + current_world_id + ambition.
 *  Decide whether to queue a cross-world travel intent. Returns the
 *  intent shape (caller persists via queueIntent) or null. */
export function chooseTravelGoal(npc, db) {
  if (!npc?.id) return null;
  const ambition = Number(npc.ambition_score ?? 0.3);
  if (ambition < 0.4) return null;

  const todayBucket = new Date().toISOString().slice(0, 10);
  const seed = `${npc.id}::ambition::${todayBucket}`;
  const roll = _seededFloat(seed);
  // Higher ambition = higher travel propensity. 0.4 ambition rolls travel ~10% of cycles, 0.9 ambition ~50%.
  if (roll > Math.max(0, ambition - 0.4)) return null;

  // Pick destination — for now, any other world that has at least one row in worlds.
  const worlds = db.prepare(`SELECT DISTINCT id FROM worlds WHERE id != ? LIMIT 50`).all(npc.current_world_id || npc.world_id || '_').map(r => r.id);
  if (worlds.length === 0) return null;
  const destination = _seededPick(worlds, seed + '::dest');
  const reason = _seededPick(TRAVEL_REASONS, seed + '::reason');

  return {
    npc_id: npc.id,
    destination_world_id: destination,
    reason,
    executes_at: Math.floor(Date.now() / 1000) + 6 * 3600, // 6h delay
  };
}

export function queueIntent(db, intent) {
  if (!db || !intent) return null;
  const id = `nti_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO npc_travel_intents
      (id, npc_id, destination_world_id, reason, created_at, executes_at, status)
    VALUES (?, ?, ?, ?, unixepoch(), ?, 'pending')
  `).run(id, intent.npc_id, intent.destination_world_id, intent.reason, intent.executes_at);
  return id;
}

export function getOpenIntent(db, npcId) {
  return db.prepare(`SELECT * FROM npc_travel_intents WHERE npc_id = ? AND status = 'pending' ORDER BY executes_at ASC LIMIT 1`).get(npcId);
}

/** Pick a single ambition move. High-ambition NPCs (≥0.7) have a real
 *  chance per cycle of a kingdom-bid or assassination; lower-ambition
 *  NPCs (≥0.4) mostly stick to skill-learn. */
export function pickAmbitionMove(npc, db) {
  if (!npc) return null;
  const ambition = Number(npc.ambition_score ?? 0.3);
  if (ambition < 0.4) return null;
  const seed = `${npc.id}::move::${new Date().toISOString().slice(0, 10)}`;
  const roll = _seededFloat(seed);
  if (ambition >= 0.7 && roll < 0.15) return { kind: 'kingdom_bid', target_kind: 'realm', target_id: null };
  if (ambition >= 0.6 && roll < 0.30) return { kind: 'assassinate',  target_kind: 'npc',   target_id: pickRivalNpc(npc, db, seed) };
  if (roll < 0.55) return { kind: 'learn_skill', target_kind: 'skill', target_id: pickRivalSkill(npc, db, seed) };
  return { kind: 'arbitrage', target_kind: 'world', target_id: null };
}

function pickRivalNpc(npc, db, seed) {
  const cands = db.prepare(`
    SELECT id FROM world_npcs
    WHERE id != ? AND world_id = ?
    LIMIT 30
  `).all(npc.id, npc.current_world_id || npc.world_id || '_').map(r => r.id);
  if (!cands.length) return null;
  return _seededPick(cands, seed + '::rival');
}

function pickRivalSkill(npc, db, seed) {
  // Pick a skill the NPC's current top rival has but NPC doesn't.
  const ownSkills = db.prepare(`SELECT skill_id FROM npc_skills WHERE npc_id = ?`).all(npc.id).map(r => r.skill_id);
  const ownSet = new Set(ownSkills);
  const cands = db.prepare(`SELECT DISTINCT skill_id FROM npc_skills LIMIT 100`).all().map(r => r.skill_id).filter(s => !ownSet.has(s));
  if (!cands.length) return null;
  return _seededPick(cands, seed + '::skill');
}

export function recordAmbitionMove(db, { npcId, moveKind, targetKind, targetId, worldId, outcome }) {
  const id = `ambm_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO npc_ambition_log (id, npc_id, move_kind, target_kind, target_id, world_id, outcome)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, npcId, moveKind, targetKind, targetId ?? null, worldId ?? null, outcome ?? null);
  return id;
}
