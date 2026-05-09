// server/lib/npc-gear.js
// NPC self-managed gear economy:
//   - Each occupation earns wealth_sparks per simulator tick
//   - Every ~20 ticks the NPC evaluates whether to upgrade a gear slot
//   - Emergent leaders transfer wealth to undergeared faction members
//   - Hard ceiling: no NPC may exceed the top-percentile active-player gear level

import crypto from 'crypto';
import logger from '../logger.js';

// ── Constants ─────────────────────────────────────────────────────────────────

// Sparks earned per simulator tick (~60 s) by occupation
const OCCUPATION_INCOME = {
  blacksmith:  4.0,  trader:     3.5,  merchant:   3.5,
  engineer:    3.0,  scientist:  3.0,  medic:      2.5,
  guard:       2.0,  journalist: 2.0,  farmer:     1.5,
  hunter:      2.0,  rogue:      2.5,  soldier:    2.0,
  default:     1.0,
};

// Cumulative cost to reach each gear level (sparks)
const GEAR_UPGRADE_COST = [0, 0, 20, 50, 100, 200, 400, 800, 1600, 3200, 6400];
const MAX_GEAR_LEVEL = 10;

// Stat increments per gear level per slot
const SLOT_STATS = {
  weapon:    (lvl) => ({ damage:  5 * lvl, speed: lvl }),
  armor:     (lvl) => ({ defense: 5 * lvl, hp:    10 * lvl }),
  tool:      (lvl) => ({ efficiency: 0.1 * lvl }),
  accessory: (lvl) => ({ luck: 0.05 * lvl, speed: Math.floor(lvl / 2) }),
};

// Archetype → default loadout slots
const ARCHETYPE_SLOTS = {
  guard:      ['weapon', 'armor'],
  soldier:    ['weapon', 'armor'],
  hunter:     ['weapon', 'armor', 'accessory'],
  rogue:      ['weapon', 'accessory'],
  blacksmith: ['tool', 'armor'],
  engineer:   ['tool', 'accessory'],
  scientist:  ['tool'],
  medic:      ['tool', 'accessory'],
  trader:     ['accessory'],
  farmer:     ['tool'],
  default:    ['weapon'],
};

// Leader faction wealth transfer: fraction of leader's surplus given per undergeared member
const LEADER_TRANSFER_FRACTION = 0.15;
// Member is "undergeared" if their gear_level < leader_gear_level - 2
const UNDERGEAR_GAP_THRESHOLD = 2;

// NPC ceiling is capped at this fraction of the active-player ceiling
const NPC_CEILING_FRACTION     = 0.90;   // regular NPCs: 90% of top player
const CONSCIOUS_CEILING_BOOST  = 0.10;   // conscious emergents: +10% (= 100% of top player)
const ACTIVE_PLAYER_WINDOW_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Wealth Accumulation ───────────────────────────────────────────────────────

export function accumulateWealth(db, npcId, occupation) {
  const income = OCCUPATION_INCOME[occupation] ?? OCCUPATION_INCOME.default;
  db.prepare('UPDATE world_npcs SET wealth_sparks = wealth_sparks + ? WHERE id = ?')
    .run(income, npcId);
}

// ── Gear Initialisation ───────────────────────────────────────────────────────

/**
 * Seed a freshly spawned NPC with starter gear for its archetype.
 * Called once by NPCSimulator._spawnNpc().
 */
export function seedStarterGear(db, npcId, archetype, startLevel = 1) {
  const slots = ARCHETYPE_SLOTS[archetype] ?? ARCHETYPE_SLOTS.default;
  for (const slot of slots) {
    const stats = SLOT_STATS[slot]?.(startLevel) ?? {};
    db.prepare(`
      INSERT OR IGNORE INTO npc_gear (id, npc_id, slot, item_id, item_name, item_type, gear_level, stats)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), npcId, slot,
      `${archetype}-${slot}-lv${startLevel}`,
      `${_capitalize(archetype)} ${_capitalize(slot)} Lv${startLevel}`,
      slot,
      startLevel,
      JSON.stringify(stats),
    );
  }
  db.prepare('UPDATE world_npcs SET gear_level = ? WHERE id = ?').run(startLevel, npcId);
}

// ── Gear Upgrade Evaluation ───────────────────────────────────────────────────

/**
 * Called every ~20 ticks per NPC. Checks wealth vs cost and upgrades the
 * lowest-level equipped slot if affordable, respecting the world gear ceiling.
 */
export function evaluateGearUpgrade(db, npcId) {
  const npc = db.prepare(
    'SELECT wealth_sparks, gear_level, archetype, is_conscious FROM world_npcs WHERE id = ?'
  ).get(npcId);
  if (!npc) return false;

  const ceiling = _getEffectiveCeiling(db, !!npc.is_conscious);
  if ((npc.gear_level ?? 1) >= ceiling) return false;

  const nextLevel = (npc.gear_level ?? 1) + 1;
  if (nextLevel > MAX_GEAR_LEVEL) return false;

  const cost = GEAR_UPGRADE_COST[nextLevel] ?? Infinity;
  if ((npc.wealth_sparks ?? 0) < cost) return false;

  // Find lowest-level gear slot to upgrade
  const lowestSlot = db.prepare(
    'SELECT id, slot, gear_level FROM npc_gear WHERE npc_id = ? AND equipped = 1 ORDER BY gear_level ASC LIMIT 1'
  ).get(npcId);
  if (!lowestSlot) return false;

  const newSlotLevel = (lowestSlot.gear_level ?? 1) + 1;
  const stats = SLOT_STATS[lowestSlot.slot]?.(newSlotLevel) ?? {};

  db.prepare(`
    UPDATE npc_gear SET gear_level = ?, item_name = ?, stats = ?
    WHERE id = ?
  `).run(
    newSlotLevel,
    `${_capitalize(npc.archetype ?? 'npc')} ${_capitalize(lowestSlot.slot)} Lv${newSlotLevel}`,
    JSON.stringify(stats),
    lowestSlot.id,
  );

  // Deduct cost, update aggregate gear_level (average of equipped slots, rounded)
  db.prepare('UPDATE world_npcs SET wealth_sparks = wealth_sparks - ? WHERE id = ?').run(cost, npcId);
  _recalcNPCGearLevel(db, npcId);

  logger.debug('npc-gear', 'upgraded', { npcId, slot: lowestSlot.slot, newSlotLevel });
  return true;
}

// ── Leader Faction Gear Enforcement ──────────────────────────────────────────

/**
 * Called by NPCSimulator during faction coordination tick.
 * Leader transfers a fraction of surplus wealth to undergeared members.
 */
export function leaderEnsuresFactionGear(db, leaderId, memberIds) {
  const leader = db.prepare(
    'SELECT wealth_sparks, gear_level FROM world_npcs WHERE id = ?'
  ).get(leaderId);
  if (!leader || !memberIds.length) return;

  const leaderLevel = leader.gear_level ?? 1;
  const leaderWealth = leader.wealth_sparks ?? 0;

  // Single batched SELECT for member gear/wealth replaces the per-member
  // lookup (was N+1).
  const memberPlaceholders = memberIds.map(() => "?").join(",");
  const memberRows = db.prepare(
    `SELECT id, wealth_sparks, gear_level FROM world_npcs WHERE id IN (${memberPlaceholders})`,
  ).all(...memberIds);
  const memberById = new Map(memberRows.map(r => [r.id, r]));

  // Collect qualifying members first; transfer amount is computed from a
  // wealth snapshot so it's identical for every recipient. Single batched
  // UPDATE replaces the per-member loop (was 2N queries → 2 queries total).
  const transfer = Math.min(leaderWealth * LEADER_TRANSFER_FRACTION, 50);
  if (transfer < 1) return;
  const recipients = [];
  for (const memberId of memberIds) {
    const member = memberById.get(memberId);
    if (!member) continue;
    const gap = leaderLevel - (member.gear_level ?? 1);
    if (gap < UNDERGEAR_GAP_THRESHOLD) continue;
    recipients.push({ memberId, gap });
  }
  if (recipients.length === 0) return;

  const totalDebit = transfer * recipients.length;
  db.prepare('UPDATE world_npcs SET wealth_sparks = wealth_sparks - ? WHERE id = ?').run(totalDebit, leaderId);
  const recipientIds = recipients.map(r => r.memberId);
  const ph = recipientIds.map(() => "?").join(",");
  db.prepare(
    `UPDATE world_npcs SET wealth_sparks = wealth_sparks + ? WHERE id IN (${ph})`,
  ).run(transfer, ...recipientIds);
  for (const { memberId, gap } of recipients) {
    logger.debug('npc-gear', 'leader_transfer', { leaderId, memberId, transfer, gap });
  }
}

// ── User Gear Ceiling ─────────────────────────────────────────────────────────

/**
 * Recomputes the ceiling from active-player gear levels.
 * Call every ~50 ticks (a few times per game-hour).
 */
export function updateUserGearCeiling(db) {
  try {
    const cutoff = Math.floor((Date.now() - ACTIVE_PLAYER_WINDOW_MS) / 1000);

    // Use max gear level from users active in the past 7 days
    // Proxy: max gear_level among player_inventory items for recently-seen users
    const row = db.prepare(`
      SELECT MAX(CAST(json_extract(metadata, '$.gear_level') AS INTEGER)) AS top_level
      FROM dtus
      WHERE type = 'item' AND owner_type = 'user'
        AND updated_at > ?
    `).get(cutoff);

    const topLevel = Math.max(1, row?.top_level ?? 1);
    db.prepare(
      'UPDATE user_gear_ceiling SET ceiling_level = ?, updated_at = unixepoch() WHERE id = 1'
    ).run(topLevel);

    return topLevel;
  } catch {
    return 1;
  }
}

/**
 * Cap any NPC that has somehow exceeded the ceiling (edge cases after player churn).
 */
export function enforceGearCeiling(db) {
  const ceiling = db.prepare('SELECT ceiling_level FROM user_gear_ceiling WHERE id = 1').get();
  if (!ceiling) return;

  const npcCap   = Math.max(1, Math.floor(ceiling.ceiling_level * NPC_CEILING_FRACTION));
  const bossCap  = Math.max(1, Math.ceil(ceiling.ceiling_level * (NPC_CEILING_FRACTION + CONSCIOUS_CEILING_BOOST)));

  db.prepare(
    'UPDATE world_npcs SET gear_level = ? WHERE is_conscious = 0 AND gear_level > ?'
  ).run(npcCap, npcCap);
  db.prepare(
    'UPDATE world_npcs SET gear_level = ? WHERE is_conscious = 1 AND gear_level > ?'
  ).run(bossCap, bossCap);
}

/**
 * Return all gear rows for an NPC (used by loot generator).
 */
export function getNPCGear(db, npcId) {
  return db.prepare('SELECT * FROM npc_gear WHERE npc_id = ? AND equipped = 1').all(npcId);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _getEffectiveCeiling(db, isConscious) {
  const row = db.prepare('SELECT ceiling_level FROM user_gear_ceiling WHERE id = 1').get();
  const base = row?.ceiling_level ?? 1;
  const fraction = isConscious
    ? NPC_CEILING_FRACTION + CONSCIOUS_CEILING_BOOST
    : NPC_CEILING_FRACTION;
  return Math.max(1, Math.floor(base * fraction));
}

function _recalcNPCGearLevel(db, npcId) {
  const slots = db.prepare(
    'SELECT gear_level FROM npc_gear WHERE npc_id = ? AND equipped = 1'
  ).all(npcId);
  if (!slots.length) return;
  const avg = slots.reduce((s, r) => s + (r.gear_level ?? 1), 0) / slots.length;
  db.prepare('UPDATE world_npcs SET gear_level = ? WHERE id = ?').run(Math.round(avg), npcId);
}

function _capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
