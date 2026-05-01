// server/lib/world-economy.js
// Supply/demand price engine. Prices move with actual gather/craft rates.

import crypto from 'node:crypto';

// ── Base prices in Concordia Credits ─────────────────────────────────────────

export const BASE_PRICES = {
  wood: 5, 'pine-wood': 6, stone: 4, herbs: 8, clay: 5, 'rare-herb': 25,
  'iron-ore': 15, 'copper-ore': 12, coal: 10, 'silver-ore': 40, 'gold-ore': 80,
  crystal: 50, 'mythril-ore': 200, 'enchanted-wood': 35, moonbloom: 45,
  runestone: 60, 'mana-crystal': 75, 'ley-essence': 55,
  'scrap-metal': 8, 'fuel-canister': 20, 'mutant-herb': 15, rubble: 3,
  'dead-wood': 4, 'titanium-scrap': 60, 'radioactive-core': 120,
  'quantum-crystal': 150, 'titanium-ore': 70, 'plasma-cell': 90,
  bioenhancer: 55, 'vibranium-ore': 300, 'gem-fragment': 100,
  branches: 2, flint: 3, 'bone': 12, 'scrap': 6, grass: 3,
};

// Resources grouped by universe type for seeding
const UNIVERSE_RESOURCES = {
  standard:    ['wood', 'stone', 'herbs', 'clay', 'iron-ore', 'coal', 'crystal', 'branches', 'flint'],
  fantasy:     ['wood', 'pine-wood', 'stone', 'herbs', 'rare-herb', 'iron-ore', 'crystal', 'enchanted-wood', 'moonbloom', 'runestone', 'mana-crystal', 'ley-essence', 'gold-ore', 'silver-ore'],
  scifi:       ['scrap-metal', 'fuel-canister', 'titanium-ore', 'titanium-scrap', 'radioactive-core', 'quantum-crystal', 'plasma-cell', 'bioenhancer'],
  post_apoc:   ['scrap-metal', 'rubble', 'dead-wood', 'mutant-herb', 'fuel-canister', 'scrap', 'bone'],
  western:     ['wood', 'stone', 'coal', 'iron-ore', 'copper-ore', 'gold-ore', 'flint', 'herbs', 'clay'],
  cyberpunk:   ['scrap-metal', 'fuel-canister', 'titanium-ore', 'quantum-crystal', 'plasma-cell', 'bioenhancer', 'scrap'],
  medieval:    ['wood', 'stone', 'clay', 'iron-ore', 'coal', 'herbs', 'bone', 'branches', 'flint', 'silver-ore'],
  vibranium:   ['vibranium-ore', 'gem-fragment', 'mythril-ore', 'mana-crystal', 'crystal', 'ley-essence'],
};

// ── Price formula ─────────────────────────────────────────────────────────────

/**
 * Compute market price from base price and supply/demand counts.
 * ratio = demand / supply; price scales between 20% and 500% of base.
 *
 * @param {number} basePrice
 * @param {number} supplyCount
 * @param {number} demandCount
 * @returns {number} integer price (minimum 1)
 */
export function computeMarketPrice(basePrice, supplyCount, demandCount) {
  const ratio = Math.max(0.1, demandCount) / Math.max(1, supplyCount);
  const price = Math.round(basePrice * Math.max(0.2, Math.min(5.0, ratio * 2)));
  return Math.max(1, Math.floor(price));
}

// ── Market queries ────────────────────────────────────────────────────────────

/**
 * Return all market rows for a world with on-the-fly computed prices.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldId
 * @returns {object[]}
 */
export function getWorldMarket(db, worldId) {
  const rows = db.prepare(
    'SELECT * FROM world_market WHERE world_id = ? ORDER BY resource_id ASC'
  ).all(worldId);

  return rows.map(r => ({
    ...r,
    computed_price: computeMarketPrice(r.base_price, r.supply_count, r.demand_count),
  }));
}

/**
 * UPSERT a market row, adjusting supply/demand and recomputing price.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldId
 * @param {string} resourceId
 * @param {number} supplyDelta   positive = more supply, negative = less
 * @param {number} demandDelta   positive = more demand, negative = less
 * @returns {object} updated market row
 */
export function updateMarketPrice(db, worldId, resourceId, supplyDelta, demandDelta) {
  const basePrice = BASE_PRICES[resourceId] ?? 10;

  // Fetch existing row or start with defaults
  let row = db.prepare(
    'SELECT * FROM world_market WHERE world_id = ? AND resource_id = ?'
  ).get(worldId, resourceId);

  const oldSupply = row?.supply_count ?? 100;
  const oldDemand = row?.demand_count ?? 10;
  const newSupply = Math.max(0, oldSupply + supplyDelta);
  const newDemand = Math.max(0, oldDemand + demandDelta);
  const newPrice  = computeMarketPrice(basePrice, newSupply, newDemand);

  if (row) {
    db.prepare(`
      UPDATE world_market
      SET supply_count = ?, demand_count = ?, current_price = ?, last_updated = unixepoch()
      WHERE world_id = ? AND resource_id = ?
    `).run(newSupply, newDemand, newPrice, worldId, resourceId);
  } else {
    db.prepare(`
      INSERT INTO world_market (id, world_id, resource_id, base_price, current_price, supply_count, demand_count, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(crypto.randomUUID(), worldId, resourceId, basePrice, newPrice, newSupply, newDemand);
  }

  return db.prepare(
    'SELECT * FROM world_market WHERE world_id = ? AND resource_id = ?'
  ).get(worldId, resourceId);
}

/**
 * Record a gather/craft/trade transaction and update market accordingly.
 *
 * type   | supplyDelta   | demandDelta
 * -------|---------------|-------------
 * gather | +quantity     | 0           (resources enter supply)
 * craft  | -quantity     | +quantity   (resources consumed → crafted items demand)
 * trade  | -quantity     | +quantity   (items leave supply → demand grows)
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldId
 * @param {string} resourceId
 * @param {number} quantity
 * @param {'gather'|'craft'|'trade'} type
 */
export function recordTransaction(db, worldId, resourceId, quantity, type) {
  let supplyDelta = 0;
  let demandDelta = 0;

  if (type === 'gather') {
    supplyDelta = quantity;
    demandDelta = 0;
  } else if (type === 'craft') {
    supplyDelta = -quantity;
    demandDelta = quantity;
  } else if (type === 'trade') {
    supplyDelta = -quantity;
    demandDelta = quantity;
  }

  return updateMarketPrice(db, worldId, resourceId, supplyDelta, demandDelta);
}

/**
 * Get the current price for a single resource, falling back to base price.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldId
 * @param {string} resourceId
 * @returns {number} price in concordia credits
 */
export function getResourcePrice(db, worldId, resourceId) {
  const row = db.prepare(
    'SELECT base_price, supply_count, demand_count FROM world_market WHERE world_id = ? AND resource_id = ?'
  ).get(worldId, resourceId);

  if (row) {
    return computeMarketPrice(row.base_price, row.supply_count, row.demand_count);
  }

  // Fallback: return base price (no market entry yet)
  return BASE_PRICES[resourceId] ?? 10;
}

/**
 * Idempotently seed world_market rows for all resources native to that world type.
 * Skips resources already present. Starting values: supply=200, demand=10.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldId
 * @param {string} universeType
 * @returns {{ seeded: number, skipped: number }}
 */
export function initWorldMarket(db, worldId, universeType) {
  // Always include common resources; supplement with universe-specific ones
  const commonResources = ['wood', 'stone', 'herbs', 'coal', 'branches', 'flint'];
  const nativeResources = UNIVERSE_RESOURCES[universeType] || UNIVERSE_RESOURCES.standard;
  const allResources    = [...new Set([...commonResources, ...nativeResources])];

  // Fetch existing rows to avoid duplicates
  const existing = new Set(
    db.prepare('SELECT resource_id FROM world_market WHERE world_id = ?')
      .all(worldId)
      .map(r => r.resource_id)
  );

  let seeded  = 0;
  let skipped = 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO world_market
      (id, world_id, resource_id, base_price, current_price, supply_count, demand_count, last_updated)
    VALUES (?, ?, ?, ?, ?, 200, 10, unixepoch())
  `);

  for (const resourceId of allResources) {
    if (existing.has(resourceId)) {
      skipped++;
      continue;
    }
    const basePrice = BASE_PRICES[resourceId] ?? 10;
    const initPrice = computeMarketPrice(basePrice, 200, 10);
    insert.run(crypto.randomUUID(), worldId, resourceId, basePrice, initPrice);
    seeded++;
  }

  return { seeded, skipped };
}
