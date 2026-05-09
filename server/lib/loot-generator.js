// server/lib/loot-generator.js
// Dynamic loot table seeded from what the NPC was actually doing at time of death.
// NPC caught mid-forge drops ore + partially-crafted blade.
// Patrol guard drops their weapon + any carried resources.
// Players who die drop a portion of their equipped gear + carried items.

import crypto from 'crypto';
import logger from '../logger.js';

const LOOT_BAG_TTL_MS   = 5 * 60 * 1000;   // 5 minutes before bag disappears
const MAX_LOOT_SLOTS    = 8;                 // cap bag size to prevent spam

// ── Activity loot tables ──────────────────────────────────────────────────────
// Each entry: { id, name, type, quantity: [min,max], schemaId?, gearLevel?, weight }
// weight is relative probability

const ACTIVITY_LOOT = {
  gathering: [
    { id: 'wood-planks',   name: 'Wood Planks',    type: 'resource', quantity: [3, 10], weight: 4 },
    { id: 'iron-ore',      name: 'Iron Ore',       type: 'resource', quantity: [2, 6],  weight: 3 },
    { id: 'stone-block',   name: 'Stone Block',    type: 'resource', quantity: [3, 8],  weight: 3 },
    { id: 'herb-bundle',   name: 'Herb Bundle',    type: 'resource', quantity: [1, 4],  weight: 2 },
    { id: 'crystal-shard', name: 'Crystal Shard',  type: 'resource', quantity: [1, 2],  weight: 1 },
  ],
  crafting: [
    { id: 'iron-ingot',    name: 'Iron Ingot',     type: 'material', quantity: [1, 3],  weight: 3 },
    { id: 'steel-bar',     name: 'Steel Bar',      type: 'material', quantity: [1, 2],  weight: 2 },
    { id: 'leather-strip', name: 'Leather Strip',  type: 'material', quantity: [2, 5],  weight: 3 },
    { id: 'gem-cut',       name: 'Cut Gem',        type: 'material', quantity: [1, 1],  weight: 1 },
    // Partial crafted item — schemaId present so the ITEM has a recipe, but the looter doesn't know it
    { id: 'partial-blade', name: 'Unfinished Blade', type: 'item',   quantity: [1, 1],  weight: 2, schemaId: 'recipe:iron-sword' },
    { id: 'partial-armor', name: 'Unfinished Chestplate', type: 'item', quantity: [1, 1], weight: 1, schemaId: 'recipe:iron-armor' },
  ],
  patrolling: [
    { id: 'ration-pack',   name: 'Field Ration',   type: 'consumable', quantity: [1, 2], weight: 3 },
    { id: 'rope-coil',     name: 'Rope Coil',      type: 'resource',   quantity: [1, 2], weight: 2 },
    { id: 'smoke-bomb',    name: 'Smoke Bomb',     type: 'consumable', quantity: [1, 1], weight: 1 },
  ],
  trading: [
    { id: 'gold-coin',     name: 'Gold Coins',     type: 'currency', quantity: [5, 30], weight: 4 },
    { id: 'trade-goods',   name: 'Trade Goods',    type: 'resource', quantity: [2, 6],  weight: 3 },
    { id: 'rare-spice',    name: 'Rare Spice',     type: 'resource', quantity: [1, 3],  weight: 1 },
  ],
  resting: [
    { id: 'bread-loaf',    name: 'Bread Loaf',     type: 'consumable', quantity: [1, 2], weight: 3 },
    { id: 'water-flask',   name: 'Water Flask',    type: 'consumable', quantity: [1, 1], weight: 2 },
  ],
  idle: [
    { id: 'misc-junk',     name: 'Miscellaneous Junk', type: 'resource', quantity: [1, 3], weight: 2 },
  ],
};

// Extra drops keyed by archetype — always added on top of activity loot
const ARCHETYPE_BONUS = {
  blacksmith:  [{ id: 'iron-ingot', name: 'Iron Ingot', type: 'material', quantity: [1, 3], weight: 1 }],
  alchemist:   [{ id: 'potion-vial', name: 'Healing Potion', type: 'consumable', quantity: [1, 2], weight: 1, schemaId: 'recipe:healing-potion' }],
  scientist:   [{ id: 'data-chip',  name: 'Data Chip',  type: 'material', quantity: [1, 1], weight: 1 }],
  medic:       [{ id: 'med-kit',    name: 'Med Kit',    type: 'consumable', quantity: [1, 2], weight: 1, schemaId: 'recipe:med-kit' }],
  hunter:      [{ id: 'arrow-bundle', name: 'Arrow Bundle', type: 'ammo', quantity: [5, 15], weight: 1 }],
  engineer:    [{ id: 'circuit-board', name: 'Circuit Board', type: 'material', quantity: [1, 2], weight: 1, schemaId: 'recipe:gadget' }],
  farmer:      [{ id: 'seed-bag',   name: 'Seed Bag',   type: 'resource', quantity: [2, 5], weight: 1 }],
};

// Faction drops — world-universe flavour
const FACTION_DROPS = {
  villain:     [{ id: 'villain-token', name: 'Crime Syndicate Token', type: 'currency', quantity: [1, 5], weight: 1 }],
  invader:     [{ id: 'alien-crystal', name: 'Alien Energy Crystal',  type: 'material', quantity: [1, 2], weight: 1, schemaId: 'recipe:alien-tech' }],
  hero:        [{ id: 'hero-badge',    name: 'Hero Insignia',          type: 'accessory', quantity: [1, 1], weight: 1 }],
  undead:      [{ id: 'bone-dust',     name: 'Bone Dust',              type: 'material', quantity: [2, 6], weight: 1 }],
  cult:        [{ id: 'rune-fragment', name: 'Rune Fragment',           type: 'material', quantity: [1, 3], weight: 1, schemaId: 'recipe:enchanted-amulet' }],
};

// ── Main exports ──────────────────────────────────────────────────────────────

/**
 * Generate loot items for a dead NPC.
 * Combines: activity resources + equipped gear + archetype bonus + faction flavour.
 *
 * @param {object} npcRow  — full world_npcs row (with current_activity, activity_resources, archetype, faction)
 * @param {object[]} gear  — rows from npc_gear (equipped items)
 * @returns {object[]}     — array of loot item objects
 */
export function generateNPCLoot(npcRow, gear = []) {
  const items = [];

  // 1. Carry activity resources (what they were hauling)
  const carrying = _parseJSON(npcRow.activity_resources, {});
  for (const [resId, qty] of Object.entries(carrying)) {
    if (qty > 0) items.push({ id: resId, name: _idToName(resId), type: 'resource', quantity: qty });
  }

  // 2. Activity-based random drops (3–5 rolls from the table)
  const activityTable = ACTIVITY_LOOT[npcRow.current_activity ?? 'idle'] ?? ACTIVITY_LOOT.idle;
  const rolls = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < rolls; i++) {
    const entry = _weightedPick(activityTable);
    if (entry) items.push(_resolveEntry(entry));
  }

  // 3. Archetype bonus drop (1–2 items always)
  const archetypeTable = ARCHETYPE_BONUS[npcRow.archetype];
  if (archetypeTable) {
    const entry = _weightedPick(archetypeTable);
    if (entry) items.push(_resolveEntry(entry));
  }

  // 4. Faction flavour (rare — 25% chance)
  if (Math.random() < 0.25) {
    const factionTable = FACTION_DROPS[npcRow.faction];
    if (factionTable) {
      const entry = _weightedPick(factionTable);
      if (entry) items.push(_resolveEntry(entry));
    }
  }

  // 5. Equipped gear — each slot has 60% drop chance (so losing all gear isn't guaranteed)
  for (const g of gear) {
    if (Math.random() < 0.60) {
      items.push({
        id:        g.item_id,
        name:      g.item_name,
        type:      g.item_type,
        quantity:  1,
        gearLevel: g.gear_level,
        stats:     _parseJSON(g.stats, {}),
        schemaId:  g.schema_id ?? null,
      });
    }
  }

  // 6. Rare schematic drop (10% × level scaling)
  const schemaChance = 0.05 + (npcRow.gear_level ?? 1) * 0.01;
  if (Math.random() < schemaChance) {
    items.push(_randomSchematic(npcRow.archetype, npcRow.gear_level));
  }

  return _dedupeAndCap(items);
}

/**
 * Generate what a player drops when killed by an NPC.
 * Players lose 1–2 equipped items (not all — too punishing) + some carried sparks.
 *
 * @param {object} playerRow  — users row
 * @param {object[]} inventory — player's equipped/carried items from DTUs
 * @returns {object[]}
 */
export function generatePlayerLoot(playerRow, inventory = []) {
  const items = [];

  // Drop sparks (10–30% of carried sparks)
  const sparks = playerRow.sparks ?? 0;
  const sparkDrop = Math.floor(sparks * (0.10 + Math.random() * 0.20));
  if (sparkDrop > 0) {
    items.push({ id: 'sparks', name: 'Sparks', type: 'currency', quantity: sparkDrop });
  }

  // Drop 1–2 random equipped items (max)
  const equipped = inventory.filter(i => i.equipped).slice(0, 6);
  const dropCount = Math.min(equipped.length, 1 + Math.floor(Math.random() * 2));
  const dropped = _shuffled(equipped).slice(0, dropCount);
  for (const item of dropped) {
    items.push({
      id:       item.id ?? item.item_id,
      name:     item.name ?? item.item_name,
      type:     item.type ?? item.item_type,
      quantity: 1,
      gearLevel: item.gearLevel ?? item.gear_level,
      schemaId: item.schemaId ?? null,
    });
  }

  return _dedupeAndCap(items);
}

/**
 * Persist a loot bag to the database.
 *
 * @param {object} db
 * @param {string} worldId
 * @param {{ x: number, y: number, z?: number }} position
 * @param {'player'|'npc'} ownerType
 * @param {string} ownerId
 * @param {'player'|'npc'} killerType
 * @param {string|null} killerId
 * @param {object[]} items
 * @returns {string} bagId
 */
export function createLootBag(db, worldId, position, ownerType, ownerId, killerType, killerId, items) {
  const bagId    = crypto.randomUUID();
  const expiresAt = Math.floor((Date.now() + LOOT_BAG_TTL_MS) / 1000);

  db.prepare(`
    INSERT INTO loot_bags (id, world_id, position, owner_type, owner_id, killer_type, killer_id, items, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bagId, worldId,
    JSON.stringify(position),
    ownerType, ownerId,
    killerType, killerId ?? null,
    JSON.stringify(items),
    expiresAt,
  );

  logger.debug('loot-generator', 'bag_created', {
    bagId, worldId, ownerType, ownerId, itemCount: items.length, expiresAt,
  });

  return bagId;
}

/**
 * Claim a loot bag — adds items to claimer's inventory DTUs and marks bag claimed.
 * Returns the claimed items on success, null if already claimed or expired.
 */
export function claimLootBag(db, bagId, claimerId, claimerType = 'player') {
  const bag = db.prepare('SELECT * FROM loot_bags WHERE id = ?').get(bagId);
  if (!bag) return null;
  if (bag.claimed_by) return null;
  if (Math.floor(Date.now() / 1000) > bag.expires_at) return null;

  db.prepare(
    'UPDATE loot_bags SET claimed_by = ?, claimed_at = unixepoch() WHERE id = ?'
  ).run(claimerId, bagId);

  const items = _parseJSON(bag.items, []);
  logger.info('loot-generator', 'bag_claimed', { bagId, claimerId, claimerType, itemCount: items.length });
  return items;
}

/**
 * Clean up expired unclaimed bags. Call periodically.
 */
export function reclaimExpiredBags(db) {
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(
    'DELETE FROM loot_bags WHERE expires_at < ? AND claimed_by IS NULL'
  ).run(now);
  return result.changes;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _weightedPick(table) {
  if (!table?.length) return null;
  const total = table.reduce((s, e) => s + (e.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const entry of table) {
    r -= (entry.weight ?? 1);
    if (r <= 0) return entry;
  }
  return table[table.length - 1];
}

function _resolveEntry(entry) {
  const [min, max] = entry.quantity ?? [1, 1];
  return {
    id:       entry.id,
    name:     entry.name,
    type:     entry.type,
    quantity: min + Math.floor(Math.random() * (max - min + 1)),
    ...(entry.schemaId ? { schemaId: entry.schemaId } : {}),
    ...(entry.gearLevel ? { gearLevel: entry.gearLevel } : {}),
  };
}

function _randomSchematic(archetype, gearLevel = 1) {
  const tier = gearLevel <= 3 ? 'basic' : gearLevel <= 6 ? 'advanced' : 'master';
  return {
    id:       `schematic-${archetype ?? 'generic'}-${tier}`,
    name:     `${_capitalize(tier)} ${_capitalize(archetype ?? 'Crafting')} Schematic`,
    type:     'schematic',
    quantity: 1,
    schemaId: `recipe:${archetype ?? 'generic'}-${tier}`,
  };
}

function _dedupeAndCap(items) {
  const seen = {};
  const out  = [];
  for (const item of items) {
    if (seen[item.id]) {
      seen[item.id].quantity = (seen[item.id].quantity ?? 1) + (item.quantity ?? 1);
    } else {
      seen[item.id] = { ...item };
      out.push(seen[item.id]);
    }
    if (out.length >= MAX_LOOT_SLOTS) break;
  }
  return out;
}

function _shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _idToName(id) {
  return id.split('-').map(_capitalize).join(' ');
}

function _capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function _parseJSON(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}
