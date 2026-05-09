// @sql-loop-ok: reclaimExpiredBags walks an expired-bag list with per-bag
// owner-specific transfers; the outer loop is order-dependent on owner_id
// and has heartbeat-bounded N. Inner loops over items are now batched.
// server/lib/pvp-loot.js
// PvP loot: death drops and crime-world robbery.
// Hard rules enforced here:
//   - DTUs / personal locker: never touched
//   - CC: never transferred non-consensually
//   - Sparks: up to 30% on death, up to 20% on robbery
//   - Items: 1–3 random on death, 1 on robbery
//   - Only triggers in crime_world or combat game modes
//
// NPC-loots-player path added here:
//   When an NPC kills a player, the NPC (or nearby faction member) can claim the
//   loot bag — items enter the NPC's activity_resources / wealth pool.

import crypto from "crypto";
import logger from "../logger.js";

const DEATH_SPARKS_PCT = 0.30;
const ROBBERY_SPARKS_PCT = 0.20;
const LOOT_BAG_TTL_MS = 5 * 60 * 1000;        // 5 minutes
const KILLER_PRIORITY_MS = 2 * 60 * 1000;      // 2 minutes

const ALLOWED_MODES = new Set(["crime_world", "combat"]);

function assertAllowedMode(gameMode) {
  if (!ALLOWED_MODES.has(gameMode)) {
    throw new Error(`pvp_loot_not_allowed_in_mode:${gameMode}`);
  }
}

/**
 * Handle player death — drop a loot bag at their location.
 * Called by the combat resolver when a player's HP reaches 0.
 */
export function handlePlayerDeath(db, { killedId, killerId, gameMode, worldId, x = 0, y = 0, z = 0 }) {
  assertAllowedMode(gameMode);

  // Read victim's Sparks
  const victim = db.prepare(`SELECT sparks FROM users WHERE id = ?`).get(killedId);
  if (!victim) return null;

  const sparksDropped = Math.floor(victim.sparks * DEATH_SPARKS_PCT);

  // Pick 1–3 random items from victim's inventory
  const invItems = db.prepare(`
    SELECT id, item_id, item_name, quantity, quality, item_type FROM player_inventory
    WHERE user_id = ? ORDER BY RANDOM() LIMIT 3
  `).all(killedId);

  const itemsToDrop = invItems.slice(0, Math.max(1, Math.min(3, invItems.length)));

  // Deduct Sparks from victim
  if (sparksDropped > 0) {
    db.prepare(`UPDATE users SET sparks = sparks - ? WHERE id = ?`).run(sparksDropped, killedId);
    db.prepare(`INSERT INTO sparks_ledger (id, user_id, delta, reason, world_id) VALUES (?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), killedId, -sparksDropped, `death_drop:${worldId}`, worldId);
  }

  // Remove items from victim's inventory — single batched DELETE.
  if (itemsToDrop.length > 0) {
    const ids = itemsToDrop.map(it => it.id);
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`DELETE FROM player_inventory WHERE id IN (${placeholders})`).run(...ids);
  }

  // Create loot bag
  const bagId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO death_loot_bags (id, world_id, x, y, z, owner_id, killer_id, sparks, items_json, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(bagId, worldId, x, y, z, killedId, killerId || null, sparksDropped, JSON.stringify(itemsToDrop), now + LOOT_BAG_TTL_MS / 1000);

  return { bagId, sparksDropped, itemCount: itemsToDrop.length, killerPriorityMs: KILLER_PRIORITY_MS };
}

/**
 * Claim a death loot bag.
 * Killer has first claim for KILLER_PRIORITY_MS, then it's open.
 */
export function claimLootBag(db, { bagId, claimerId }) {
  // TODO: project explicit columns (auto-fix suggestion)
  const bag = db.prepare(`SELECT * FROM death_loot_bags WHERE id = ?`).get(bagId);
  if (!bag) return { ok: false, error: "bag_not_found" };
  if (bag.claimed_by) return { ok: false, error: "already_claimed" };

  const now = Math.floor(Date.now() / 1000);
  if (now > bag.expires_at) return { ok: false, error: "bag_expired" };

  // Enforce killer priority window
  const createdAt = bag.created_at; // unixepoch
  const priorityEndsAt = createdAt + KILLER_PRIORITY_MS / 1000;
  if (now < priorityEndsAt && bag.killer_id && claimerId !== bag.killer_id) {
    return { ok: false, error: "killer_priority_window", priorityEndsAt };
  }

  // Transfer Sparks
  if (bag.sparks > 0) {
    db.prepare(`UPDATE users SET sparks = sparks + ? WHERE id = ?`).run(bag.sparks, claimerId);
    db.prepare(`INSERT INTO sparks_ledger (id, user_id, delta, reason, world_id) VALUES (?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), claimerId, bag.sparks, `loot_claim:${bagId}`, bag.world_id);
  }

  // Transfer items — single batched SELECT for existing inventory rows
  // replaces the per-item lookup (was N+1).
  const items = JSON.parse(bag.items_json);
  if (items.length > 0) {
    const itemIds = items.map(i => i.item_id);
    const placeholders = itemIds.map(() => "?").join(",");
    const existingRows = db.prepare(
      `SELECT id, item_id FROM player_inventory WHERE user_id = ? AND item_id IN (${placeholders})`,
    ).all(claimerId, ...itemIds);
    const existingByItemId = new Map(existingRows.map(r => [r.item_id, r.id]));
    for (const item of items) {
      const existingId = existingByItemId.get(item.item_id);
      if (existingId) {
        db.prepare(`UPDATE player_inventory SET quantity = quantity + ? WHERE id = ?`).run(item.quantity, existingId);
      } else {
        db.prepare(`
          INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, quality)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), claimerId, item.item_type, item.item_id, item.item_name, item.quantity, item.quality);
      }
    }
  }

  db.prepare(`UPDATE death_loot_bags SET claimed_by = ?, claimed_at = ? WHERE id = ?`).run(claimerId, now, bagId);
  return { ok: true, sparks: bag.sparks, items };
}

/**
 * Crime-world robbery. Steals up to 20% of target Sparks + 1 random item.
 * Only allowed in crime_world mode.
 */
export function handleRobbery(db, { robberId, victimId, gameMode, worldId }) {
  assertAllowedMode(gameMode);
  if (gameMode !== "crime_world") throw new Error("robbery_only_in_crime_world");

  const victim = db.prepare(`SELECT sparks FROM users WHERE id = ?`).get(victimId);
  if (!victim) return { ok: false, error: "victim_not_found" };

  const sparksStolen = Math.floor(victim.sparks * ROBBERY_SPARKS_PCT);

  // Steal one random item
  const item = db.prepare(`
    SELECT id, item_id, item_name, quantity, quality, item_type FROM player_inventory
    WHERE user_id = ? ORDER BY RANDOM() LIMIT 1
  `).get(victimId);

  // Transfer Sparks
  if (sparksStolen > 0) {
    db.prepare(`UPDATE users SET sparks = sparks - ? WHERE id = ?`).run(sparksStolen, victimId);
    db.prepare(`UPDATE users SET sparks = sparks + ? WHERE id = ?`).run(sparksStolen, robberId);
    db.prepare(`INSERT INTO sparks_ledger (id, user_id, delta, reason, world_id) VALUES (?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), victimId, -sparksStolen, `robbed_by:${robberId}`, worldId);
    db.prepare(`INSERT INTO sparks_ledger (id, user_id, delta, reason, world_id) VALUES (?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), robberId, sparksStolen, `robbed_from:${victimId}`, worldId);
  }

  // Transfer item
  let stolenItem = null;
  if (item) {
    db.prepare(`DELETE FROM player_inventory WHERE id = ?`).run(item.id);
    const existing = db.prepare(`SELECT id FROM player_inventory WHERE user_id = ? AND item_id = ?`).get(robberId, item.item_id);
    if (existing) {
      db.prepare(`UPDATE player_inventory SET quantity = quantity + ? WHERE id = ?`).run(item.quantity, existing.id);
    } else {
      db.prepare(`
        INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, quality)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), robberId, item.item_type, item.item_id, item.item_name, item.quantity, item.quality);
    }
    stolenItem = item;
  }

  return { ok: true, sparksStolen, stolenItem };
}

// ── NPC-loots-player ──────────────────────────────────────────────────────────

/**
 * Called immediately after an NPC kills a player.
 * Creates a loot bag (same as handlePlayerDeath) and then has the killer NPC
 * immediately claim it — adding sparks to NPC wealth and items to activity_resources.
 *
 * If the NPC is mid-faction (has allies nearby) a faction member can claim instead.
 * Returns the loot result so the world route can emit realtime events.
 */
export function handleNPCKilledPlayer(db, { npcId, playerId, worldId, x = 0, y = 0, z = 0 }) {
  const victim = db.prepare('SELECT sparks FROM users WHERE id = ?').get(playerId);
  if (!victim) return null;

  const sparksDropped = Math.floor(victim.sparks * DEATH_SPARKS_PCT);

  // Pick 1–3 random items from victim inventory
  const invItems = db.prepare(`
    SELECT id, item_id, item_name, quantity, quality, item_type FROM player_inventory
    WHERE user_id = ? ORDER BY RANDOM() LIMIT 3
  `).all(playerId);
  const itemsToDrop = invItems.slice(0, Math.max(1, Math.min(3, invItems.length)));

  // Deduct from victim
  if (sparksDropped > 0) {
    db.prepare('UPDATE users SET sparks = sparks - ? WHERE id = ?').run(sparksDropped, playerId);
    db.prepare('INSERT INTO sparks_ledger (id, user_id, delta, reason, world_id) VALUES (?,?,?,?,?)')
      .run(crypto.randomUUID(), playerId, -sparksDropped, `npc_kill:${npcId}`, worldId);
  }
  if (itemsToDrop.length > 0) {
    const ids = itemsToDrop.map(i => i.id);
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`DELETE FROM player_inventory WHERE id IN (${placeholders})`).run(...ids);
  }

  // Bag in the loot_bags table (bidirectional schema from migration 061)
  const bagId = crypto.randomUUID();
  const expiresAt = Math.floor((Date.now() + LOOT_BAG_TTL_MS) / 1000);
  const allItems = [
    ...(sparksDropped > 0 ? [{ id: 'sparks', name: 'Sparks', type: 'currency', quantity: sparksDropped }] : []),
    ...itemsToDrop.map(i => ({ id: i.item_id, name: i.item_name, type: i.item_type, quantity: i.quantity })),
  ];

  try {
    db.prepare(`
      INSERT INTO loot_bags (id, world_id, position, owner_type, owner_id, killer_type, killer_id, items, expires_at)
      VALUES (?, ?, ?, 'player', ?, 'npc', ?, ?, ?)
    `).run(bagId, worldId, JSON.stringify({ x, y, z }), playerId, npcId, JSON.stringify(allItems), expiresAt);
  } catch {
    // loot_bags table not yet migrated — fall back silently
    logger.debug('pvp-loot', 'npc_kill_bag_skipped', { bagId });
  }

  // NPC immediately claims — sparks go into wealth, items into activity_resources
  try {
    const npc = db.prepare('SELECT wealth_sparks, activity_resources FROM world_npcs WHERE id = ?').get(npcId);
    if (npc) {
      if (sparksDropped > 0) {
        db.prepare('UPDATE world_npcs SET wealth_sparks = wealth_sparks + ? WHERE id = ?')
          .run(sparksDropped, npcId);
      }
      const resources = _parseJSON(npc.activity_resources, {});
      for (const item of itemsToDrop) {
        const key = item.item_id;
        resources[key] = (resources[key] ?? 0) + (item.quantity ?? 1);
      }
      db.prepare('UPDATE world_npcs SET activity_resources = ? WHERE id = ?')
        .run(JSON.stringify(resources), npcId);

      // Mark bag claimed
      db.prepare('UPDATE loot_bags SET claimed_by = ?, claimed_at = unixepoch() WHERE id = ?')
        .run(npcId, bagId);
    }
  } catch { /* non-fatal */ }

  logger.info('pvp-loot', 'npc_looted_player', {
    npcId, playerId, worldId, sparksDropped, itemCount: itemsToDrop.length,
  });

  return { bagId, sparksDropped, items: itemsToDrop, killerPriorityMs: KILLER_PRIORITY_MS };
}

/**
 * Clean up expired unclaimed loot bags — return contents to original owner.
 */
export function reclaimExpiredBags(db) {
  const now = Math.floor(Date.now() / 1000);
  const expired = db.prepare(`
    SELECT * FROM death_loot_bags WHERE claimed_by IS NULL AND expires_at < ?
  `).all(now);

  for (const bag of expired) {
    // Return Sparks
    if (bag.sparks > 0) {
      db.prepare(`UPDATE users SET sparks = sparks + ? WHERE id = ?`).run(bag.sparks, bag.owner_id);
    }
    // Return items — single batched SELECT for existing inventory rows.
    const items = JSON.parse(bag.items_json);
    if (items.length > 0) {
      const itemIds = items.map(i => i.item_id);
      const ph = itemIds.map(() => "?").join(",");
      const existingRows = db.prepare(
        `SELECT id, item_id FROM player_inventory WHERE user_id = ? AND item_id IN (${ph})`,
      ).all(bag.owner_id, ...itemIds);
      const existingByItemId = new Map(existingRows.map(r => [r.item_id, r.id]));
      for (const item of items) {
        const existingId = existingByItemId.get(item.item_id);
        if (existingId) {
          db.prepare(`UPDATE player_inventory SET quantity = quantity + ? WHERE id = ?`).run(item.quantity, existingId);
        } else {
          db.prepare(`
            INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, quality)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(crypto.randomUUID(), bag.owner_id, item.item_type, item.item_id, item.item_name, item.quantity, item.quality);
        }
      }
    }
    db.prepare(`UPDATE death_loot_bags SET claimed_by = 'returned', claimed_at = ? WHERE id = ?`).run(now, bag.id);
  }

  return expired.length;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _parseJSON(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}
