// server/lib/world-gathering.js
// Player resource gathering: find nearby nodes, extract resources, deplete + respawn,
// swimming state detection, underground ore access.

import crypto from 'node:crypto';
import logger from '../logger.js';
import { baseElevation, getElevationAt } from './terrain-deformation.js';
import { waterDepthAt } from './terrain-water.js';

const WORLD_SIZE   = 2000;
const WATER_ELEV   = 5;    // metres — below this is water
const GATHER_RANGE = 12;   // metres — player must be within this of a node to gather
const SWIM_DEPTH   = 1.5;  // metres of water depth that triggers swim state

// Tool-type → node_type compatibility
// Players need the right tool; unarmed gives 50% penalty
const TOOL_COMPAT = {
  axe:     ['tree'],
  pickaxe: ['ore_vein', 'stone', 'crystal', 'fuel'],
  sickle:  ['herb', 'soil'],
  hands:   ['herb', 'soil', 'spring'],    // unarmed — can harvest soft nodes
  bucket:  ['spring', 'soil'],
  drill:   ['ore_vein', 'crystal', 'fuel'], // advanced — same as pickaxe + bonus
};

// ── Terrain helper (same formula as client + npc-simulator) ───────────────────

// Phase 0.6 — the base heightmap now lives in terrain-deformation.js so the
// server, client, and NPC pathing all sample ONE source (killing the prior
// sin-wave divergence). This is the seed base; persisted deltas layer on top.
function getElevation(wx, wz) {
  return baseElevation(wx, wz);
}

// ── Swimming ──────────────────────────────────────────────────────────────────

/**
 * Determine swim state from player position.
 * @param {{ x: number, z: number, y?: number }} pos
 * @returns {{ swimming: boolean, waterDepth: number }}
 */
export function checkSwimState(pos) {
  const surfaceElev = getElevation(pos.x, pos.z);
  const playerY     = pos.y ?? surfaceElev;
  const waterDepth  = Math.max(0, WATER_ELEV - surfaceElev);  // how deep the water is here
  const swimming    = surfaceElev < WATER_ELEV && playerY <= surfaceElev + SWIM_DEPTH;
  return { swimming, waterDepth: Math.round(waterDepth * 10) / 10 };
}

/**
 * Update world_visits swimming state for a player.
 * Called when the player moves in the world.
 */
export function updateSwimState(db, worldId, userId, pos) {
  try {
    let { swimming, waterDepth } = checkSwimState(pos);
    // Phase 0.6 — prefer the persisted per-cell water column (a dug-and-flooded
    // ditch makes you swim even on high ground) over the global low-elev plane.
    try {
      const cellWater = waterDepthAt(db, worldId, pos.x, pos.z);
      if (cellWater > waterDepth) {
        waterDepth = Math.round(cellWater * 10) / 10;
        const surfaceElev = getElevationAt(db, worldId, pos.x, pos.z);
        const playerY = pos.y ?? surfaceElev;
        swimming = playerY <= surfaceElev + cellWater;
      }
    } catch { /* water grid absent — fall back to plane */ }
    db.prepare(`
      UPDATE world_visits SET is_swimming = ?, swim_depth = ?, last_position = ?
      WHERE world_id = ? AND user_id = ? AND departed_at IS NULL
    `).run(swimming ? 1 : 0, waterDepth, JSON.stringify(pos), worldId, userId);
    return { swimming, waterDepth };
  } catch { return { swimming: false, waterDepth: 0 }; }
}

// ── Node queries ──────────────────────────────────────────────────────────────

/**
 * Return resource nodes within `radius` metres of (x, z).
 * Excludes fully depleted nodes (respawn pending).
 */
export function getNearbyNodes(db, worldId, x, z, radius = GATHER_RANGE) {
  const nodes = db.prepare(
    'SELECT * FROM world_resource_nodes WHERE world_id = ? AND is_depleted = 0 AND depth = 0'
  ).all(worldId);
  const r2 = radius * radius;
  return nodes
    .filter(n => {
      const dx = n.x - x, dz = n.z - z;
      return dx * dx + dz * dz <= r2;
    })
    .map(n => ({
      ...n,
      distance: Math.sqrt((n.x - x) ** 2 + (n.z - z) ** 2),
    }))
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Return underground nodes accessible from a surface position (within 20m).
 * Used for mining — player must be near a cave entrance or mine shaft.
 */
export function getUndergroundNodes(db, worldId, x, z, depth = 0) {
  const nodes = db.prepare(
    'SELECT * FROM world_resource_nodes WHERE world_id = ? AND is_depleted = 0 AND depth > 0'
  ).all(worldId);
  const radius = 25;
  const r2 = radius * radius;
  return nodes
    .filter(n => {
      const dx = n.x - x, dz = n.z - z;
      return dx * dx + dz * dz <= r2 && n.depth >= depth;
    })
    .sort((a, b) => a.depth - b.depth);
}

// ── Yield calculation ────────────────────────────────────────────────────────

/**
 * Calculate how many resources are extracted in one gather action.
 *
 * Base yield: 1 + (toolTier - 1) × 0.5 + (skillLevel / difficulty)
 * Tool compatibility bonus: +0.5 per tier above minimum
 * Underground bonus: +25% for any underground node
 *
 * @param {object} node
 * @param {string} toolType      e.g. 'axe', 'pickaxe', 'hands'
 * @param {number} toolTier      1–5 (1=basic, 5=legendary)
 * @param {number} skillLevel    0–100 player skill
 * @returns {{ amount: number, partial: boolean }}
 */
export function estimateYield(node, toolType = 'hands', toolTier = 1, skillLevel = 1) {
  const compatible = (TOOL_COMPAT[toolType] || []).includes(node.node_type);
  const toolMult   = compatible ? 1.0 : 0.5;         // wrong tool = 50% penalty
  const drillBonus = toolType === 'drill' ? 0.3 : 0; // drill is superior
  const depthBonus = node.depth > 0 ? 0.25 : 0;      // mining underground rewarded

  const base = 1 + (toolTier - 1) * 0.5 + (skillLevel / Math.max(1, node.difficulty * 10));
  const amount = Math.max(1, Math.round(base * toolMult * (1 + depthBonus + drillBonus)));

  // Can't extract more than remains
  const capped  = Math.min(amount, node.quantity_remaining);
  const partial = capped < amount;
  return { amount: capped, partial };
}

// ── Main gather action ────────────────────────────────────────────────────────

/**
 * Player gathers from a specific resource node.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} nodeId
 * @param {string} gatheredBy    user_id
 * @param {object} opts
 * @param {string} [opts.toolType]
 * @param {number} [opts.toolTier]
 * @param {number} [opts.skillLevel]
 * @param {{ x: number, z: number }} [opts.playerPos]
 * @returns {{ ok: boolean, gathered?: object[], nodeState?: object, error?: string }}
 */
export function gatherFromNode(db, nodeId, gatheredBy, opts = {}) {
  const { toolType = 'hands', toolTier = 1, skillLevel = 1, playerPos } = opts;


  const node = db.prepare('SELECT * FROM world_resource_nodes WHERE id = ?').get(nodeId);
  if (!node) return { ok: false, error: 'node_not_found' };
  if (node.is_depleted) return { ok: false, error: 'node_depleted' };

  // Range check
  if (playerPos) {
    const dx = node.x - playerPos.x, dz = node.z - playerPos.z;
    if (dx * dx + dz * dz > GATHER_RANGE * GATHER_RANGE * 4) {
      return { ok: false, error: 'too_far' };
    }
  }

  const { amount } = estimateYield(node, toolType, toolTier, skillLevel);
  const now = Math.floor(Date.now() / 1000);

  // G4 — TOCTOU-safe decrement. The old code SET an absolute quantity computed
  // from the stale SELECT above, so two concurrent/duplicate gathers (double-
  // click, or two world-shard writers) could each read 10 and each write 5 →
  // double-harvest. Decrement RELATIVE to the live column, gated on the node
  // still being un-depleted, in one atomic statement. `changes===1` means we
  // won the decrement; otherwise another request emptied it first.
  const upd = db.prepare(`
    UPDATE world_resource_nodes
    SET quantity_remaining = MAX(0, quantity_remaining - ?),
        is_depleted = CASE WHEN quantity_remaining - ? <= 0 THEN 1 ELSE 0 END,
        respawn_at  = CASE WHEN quantity_remaining - ? <= 0 THEN ? + (respawn_hours * 3600) ELSE NULL END,
        last_gathered_by = ?,
        last_gathered_at = ?
    WHERE id = ? AND is_depleted = 0 AND quantity_remaining > 0
  `).run(amount, amount, amount, now, gatheredBy, now, nodeId);
  if (upd.changes !== 1) return { ok: false, error: 'node_depleted' };

  // Actual units extracted = what was really there (the node never goes
  // negative — MAX(0) above), so a near-empty node yields only its remainder.
  const extracted = Math.min(amount, node.quantity_remaining);
  const newQty = node.quantity_remaining - extracted;
  const depleted = newQty <= 0;

  // Determine quality of gathered resources (rare nodes can drop better items)
  const droppedQuality = _rolledQuality(node.quality, skillLevel);

  const gathered = [{
    item:         node.resource_id,
    name:         node.resource_name,
    quantity:     extracted,
    quality:      droppedQuality,
    fromNodeType: node.node_type,
  }];

  // Trees also drop a small amount of resin/branches
  if (node.node_type === 'tree' && extracted > 0) {
    gathered.push({ item: 'branches', name: 'Branches', quantity: Math.ceil(extracted / 2), quality: 'common', fromNodeType: 'tree' });
  }
  // Coal seam drops a small flint chip
  if (node.resource_id === 'coal' && Math.random() < 0.25) {
    gathered.push({ item: 'flint', name: 'Flint', quantity: 1, quality: 'common', fromNodeType: 'fuel' });
  }
  // Deep ore veins occasionally drop gem fragments
  if (node.depth > 20 && node.node_type === 'ore_vein' && Math.random() < 0.1) {
    gathered.push({ item: 'gem-fragment', name: 'Gem Fragment', quantity: 1, quality: 'uncommon', fromNodeType: 'ore_vein' });
  }

  logger.debug('world-gathering', 'gathered', {
    nodeId, gatheredBy, resource: node.resource_id, amount, depleted,
  });

  return {
    ok: true,
    gathered,
    nodeState: {
      id:                node.id,
      quantityRemaining: newQty,
      maxQuantity:       node.max_quantity,
      isDepleted:        depleted,
      respawnAt:         depleted ? now + node.respawn_hours * 3600 : null,
    },
  };
}

/**
 * NPC gathers from a node (simpler — no tool type, skill is NPC level).
 * Returns the resource_id and amount extracted, or null if no node available.
 */
export function npcGatherFromNode(db, worldId, npcX, npcZ, npcLevel = 1, preferredResources = []) {
  const nearby = getNearbyNodes(db, worldId, npcX, npcZ, 30);
  if (!nearby.length) return null;

  // Filter to preferred resources if specified; otherwise take closest
  const preferred = preferredResources.length
    ? nearby.filter(n => preferredResources.includes(n.resource_id))
    : nearby;
  const target = preferred[0] || nearby[0];

  const { amount } = estimateYield(target, 'hands', Math.min(3, Math.ceil(npcLevel / 3)), npcLevel * 10);
  const newQty = Math.max(0, target.quantity_remaining - amount);
  const depleted = newQty === 0;
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    UPDATE world_resource_nodes
    SET quantity_remaining = ?,
        is_depleted = ?,
        respawn_at = CASE WHEN ? THEN ? + (respawn_hours * 3600) ELSE NULL END,
        last_gathered_by = ?,
        last_gathered_at = ?
    WHERE id = ?
  `).run(newQty, depleted ? 1 : 0, depleted ? 1 : 0, now, `npc:${npcLevel}`, now, target.id);

  return { resourceId: target.resource_id, resourceName: target.resource_name, amount, nodeId: target.id };
}

// ── Respawn tick ─────────────────────────────────────────────────────────────

/**
 * Restore depleted nodes whose respawn_at has passed.
 * Call from the heartbeat tick (e.g. every minute).
 * @param {import('better-sqlite3').Database} db
 * @returns {number} nodes restored
 */
export function respawnExpiredNodes(db) {
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    UPDATE world_resource_nodes
    SET is_depleted = 0,
        quantity_remaining = max_quantity,
        respawn_at = NULL
    WHERE is_depleted = 1 AND respawn_at IS NOT NULL AND respawn_at <= ?
  `).run(now);
  if (result.changes > 0)
    {logger.debug('world-gathering', 'nodes_respawned', { count: result.changes });}
  return result.changes;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _rolledQuality(baseQuality, skillLevel) {
  const roll = Math.random();
  const bonus = skillLevel / 200; // max +0.5 at skill 100
  if (baseQuality === 'legendary') return 'legendary';
  if (baseQuality === 'rare'     ) return roll + bonus > 0.85 ? 'legendary' : 'rare';
  if (baseQuality === 'uncommon' ) return roll + bonus > 0.80 ? 'rare' : 'uncommon';
  // common — small chance to drop uncommon with high skill
  return roll + bonus > 0.90 ? 'uncommon' : 'common';
}
