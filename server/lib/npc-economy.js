// server/lib/npc-economy.js
//
// Phase 4b — Living Economy.
//
// NPCs at their workplaces (Phase 4a) actually do economic work:
//   - performGather(npc) at 'wilds' / 'grove' produces 1 raw resource
//   - performCraft(npc) at 'workplace' consumes 2 inputs → 1 output
//   - performTrade(npc) at 'market' moves resources between NPC
//     inventories in the same world
//   - consumePersonalNeeds(npc) periodically eats meal/preserved_food
//
// Every action writes an economy_flows row. computeRegionalScarcity
// folds a rolling window into regional_scarcity per (world, resource).
// priceModulator(world, resource) returns a multiplier marketplaces
// (NPC + player) read to price listings honestly.
//
// Determinism: NPC actions use a seed-stable RNG keyed by (npc_id, hour
// bucket) so reruns within the same block produce the same outputs.

import crypto from "node:crypto";
import logger from "../logger.js";

// ── Resource taxonomy ───────────────────────────────────────────────────────

export const RAW_RESOURCES = [
  "wood", "stone", "ore", "herb", "fiber", "meat", "salt", "crystal",
];

export const FINISHED_GOODS = [
  "weapon", "armor", "tool", "remedy", "cloth", "meal",
  "preserved_food", "jewel",
];

// Archetype → what they gather in 'wilds' / 'grove'.
const ARCHETYPE_GATHER_TARGETS = {
  warrior:  ["meat", "ore"],
  hunter:   ["meat", "fiber"],
  scholar:  ["herb", "crystal"],
  mystic:   ["herb", "crystal"],
  healer:   ["herb", "fiber"],
  trader:   ["salt", "stone"],
  guard:    ["stone", "ore"],
  default:  ["wood", "stone"],
};

// Archetype → recipe: { output, inputs: [resource × 2] }.
// Each NPC craft block consumes 2 raw inputs and produces 1 finished good.
const ARCHETYPE_CRAFT_RECIPES = {
  warrior:  { output: "weapon",         inputs: ["ore", "wood"] },
  guard:    { output: "armor",          inputs: ["ore", "fiber"] },
  scholar:  { output: "tool",           inputs: ["wood", "ore"] },
  mystic:   { output: "remedy",         inputs: ["herb", "crystal"] },
  healer:   { output: "remedy",         inputs: ["herb", "fiber"] },
  hunter:   { output: "preserved_food", inputs: ["meat", "salt"] },
  trader:   { output: "cloth",          inputs: ["fiber", "salt"] },
  default:  { output: "meal",           inputs: ["meat", "herb"] },
};

// Personal needs — every consume tick the NPC eats 1 meal/preserved_food.
const NEED_CONSUMPTION = ["meal", "preserved_food"];

// Window for scarcity computation (seconds).
const SCARCITY_WINDOW_S = 3600; // 1h

// Maximum scarcity multiplier — clamps the price modulator so a single
// outlier doesn't break the marketplace.
const MAX_SCARCITY = 1.0;
const MIN_SCARCITY = -0.5;

// ── Determinism helpers ─────────────────────────────────────────────────────

function seededFloat(npcId, suffix) {
  const buf = crypto.createHash("sha1").update(`${npcId}|${suffix}`).digest();
  return ((buf[0] << 8) + buf[1]) / 65536;
}

function pickFromArray(arr, npcId, suffix) {
  if (!arr || arr.length === 0) return null;
  const r = seededFloat(npcId, suffix);
  return arr[Math.floor(r * arr.length)];
}

// ── Inventory helpers ───────────────────────────────────────────────────────

export function getInventory(db, npcId) {
  if (!db || !npcId) return {};
  try {
    const rows = db.prepare(`SELECT resource_kind, quantity FROM npc_inventory WHERE npc_id = ?`).all(npcId);
    const out = {};
    for (const r of rows) out[r.resource_kind] = r.quantity || 0;
    return out;
  } catch { return {}; }
}

function addInventory(db, npcId, resourceKind, delta) {
  // Single statement upsert; never blocks on missing row.
  db.prepare(`
    INSERT INTO npc_inventory (npc_id, resource_kind, quantity, updated_at)
    VALUES (?, ?, MAX(0, ?), unixepoch())
    ON CONFLICT(npc_id, resource_kind) DO UPDATE SET
      quantity   = MAX(0, npc_inventory.quantity + ?),
      updated_at = unixepoch()
  `).run(npcId, resourceKind, delta, delta);
}

function writeFlow(db, worldId, npcId, flowKind, resourceKind, quantity) {
  const id = `flow_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO economy_flows
      (id, world_id, npc_id, flow_kind, resource_kind, quantity, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
  `).run(id, worldId, npcId, flowKind, resourceKind, quantity);
}

// ── Public action API ───────────────────────────────────────────────────────

/**
 * Gather one raw resource. Deterministic by (npc_id, current_hour_bucket).
 * Writes a 'gather' flow row. Returns { ok, resource_kind } or
 * { ok: false, reason }.
 */
export function performGather(db, npc, opts = {}) {
  if (!db || !npc?.id) return { ok: false, reason: "no_npc" };
  const archetype = String(npc.archetype || "default").toLowerCase();
  const targets = ARCHETYPE_GATHER_TARGETS[archetype] || ARCHETYPE_GATHER_TARGETS.default;
  const hourBucket = opts.hourBucket ?? Math.floor(Date.now() / 3600000);
  const resourceKind = pickFromArray(targets, npc.id, `gather|${hourBucket}`);
  if (!resourceKind) return { ok: false, reason: "no_targets" };

  const tx = db.transaction(() => {
    addInventory(db, npc.id, resourceKind, 1);
    writeFlow(db, npc.world_id || "concordia-hub", npc.id, "gather", resourceKind, 1);
  });
  try { tx(); }
  catch (err) { return { ok: false, reason: "tx_failed", error: err?.message }; }
  return { ok: true, resource_kind: resourceKind };
}

/**
 * Consume 2 inputs from the NPC's inventory + produce 1 output good.
 * If inputs are missing, returns { ok: false, reason: 'inputs_missing' }
 * — caller can defer the craft; the NPC will buy or trade for inputs
 * later.
 */
export function performCraft(db, npc) {
  if (!db || !npc?.id) return { ok: false, reason: "no_npc" };
  const archetype = String(npc.archetype || "default").toLowerCase();
  const recipe = ARCHETYPE_CRAFT_RECIPES[archetype] || ARCHETYPE_CRAFT_RECIPES.default;

  const inv = getInventory(db, npc.id);
  for (const input of recipe.inputs) {
    if ((inv[input] || 0) < 1) {
      return { ok: false, reason: "inputs_missing", missing: input };
    }
  }

  const tx = db.transaction(() => {
    for (const input of recipe.inputs) {
      addInventory(db, npc.id, input, -1);
      writeFlow(db, npc.world_id || "concordia-hub", npc.id, "craft_input", input, 1);
    }
    addInventory(db, npc.id, recipe.output, 1);
    writeFlow(db, npc.world_id || "concordia-hub", npc.id, "craft_output", recipe.output, 1);
  });
  try { tx(); }
  catch (err) { return { ok: false, reason: "tx_failed", error: err?.message }; }
  return { ok: true, output: recipe.output, inputs_used: recipe.inputs };
}

/**
 * Trade: this NPC at the market offers up to 1 surplus item to a peer
 * NPC in the same world who needs it. Surplus = any item with qty > 2;
 * need = inputs the recipe requires that aren't in stock.
 *
 * The transfer is a swap of equivalent value (1 unit for 1 unit when
 * possible, 1 unit for 0 wealth_sparks pivot when not). Writes
 * 'trade_out' for seller + 'trade_in' for buyer.
 */
export function performTrade(db, npc) {
  if (!db || !npc?.id) return { ok: false, reason: "no_npc" };
  const inv = getInventory(db, npc.id);
  const surplus = Object.entries(inv).filter(([_k, q]) => q > 2).map(([k]) => k);
  if (surplus.length === 0) return { ok: false, reason: "no_surplus" };

  // Find a peer NPC in same world who is missing one of these.
  const surplusItem = surplus[0];
  const peers = db.prepare(`
    SELECT n.id, n.archetype
    FROM world_npcs n
    WHERE n.world_id = ? AND n.id != ? AND COALESCE(n.is_dead, 0) = 0
    LIMIT 50
  `).all(npc.world_id, npc.id);

  for (const peer of peers) {
    const peerInv = getInventory(db, peer.id);
    if ((peerInv[surplusItem] || 0) > 0) continue;
    // Does the peer's recipe need this item?
    const peerRecipe = ARCHETYPE_CRAFT_RECIPES[String(peer.archetype || "default").toLowerCase()] || ARCHETYPE_CRAFT_RECIPES.default;
    if (!peerRecipe.inputs.includes(surplusItem)) continue;

    const tx = db.transaction(() => {
      addInventory(db, npc.id, surplusItem, -1);
      addInventory(db, peer.id, surplusItem, 1);
      writeFlow(db, npc.world_id, npc.id,  "trade_out", surplusItem, 1);
      writeFlow(db, npc.world_id, peer.id, "trade_in",  surplusItem, 1);
    });
    try { tx(); }
    catch (err) { return { ok: false, reason: "tx_failed", error: err?.message }; }
    return { ok: true, gave: surplusItem, to_npc: peer.id };
  }
  return { ok: false, reason: "no_buyer" };
}

/**
 * Personal needs — NPC eats one meal-style item. Throttled by caller
 * (typically the heartbeat picks consume blocks every N passes).
 */
export function consumePersonalNeeds(db, npc) {
  if (!db || !npc?.id) return { ok: false, reason: "no_npc" };
  const inv = getInventory(db, npc.id);
  const haveMeal = NEED_CONSUMPTION.find(item => (inv[item] || 0) > 0);
  if (!haveMeal) return { ok: false, reason: "no_food" };
  const tx = db.transaction(() => {
    addInventory(db, npc.id, haveMeal, -1);
    writeFlow(db, npc.world_id || "concordia-hub", npc.id, "consume", haveMeal, 1);
  });
  try { tx(); }
  catch (err) { return { ok: false, reason: "tx_failed", error: err?.message }; }
  return { ok: true, consumed: haveMeal };
}

// ── Scarcity computation ────────────────────────────────────────────────────

/**
 * Compute scarcity for one (world, resource) over the last
 * SCARCITY_WINDOW_S seconds. Scarcity = (consumption - production) /
 * (consumption + production + 1), clamped to [MIN_SCARCITY, MAX_SCARCITY].
 *
 * Positive = demand exceeds supply (prices should rise).
 * Negative = supply glut (prices should fall).
 */
export function computeRegionalScarcity(db, worldId, resourceKind) {
  if (!db || !worldId || !resourceKind) return 0;
  const cutoff = Math.floor(Date.now() / 1000) - SCARCITY_WINDOW_S;
  let production = 0;
  let consumption = 0;
  try {
    const rows = db.prepare(`
      SELECT flow_kind, SUM(quantity) AS qty
      FROM economy_flows
      WHERE world_id = ? AND resource_kind = ? AND occurred_at > ?
      GROUP BY flow_kind
    `).all(worldId, resourceKind, cutoff);
    for (const r of rows) {
      if (r.flow_kind === "gather" || r.flow_kind === "craft_output") {
        production += r.qty || 0;
      } else if (r.flow_kind === "craft_input" || r.flow_kind === "consume") {
        consumption += r.qty || 0;
      }
    }
  } catch { return 0; }

  const denom = production + consumption + 1;
  let s = (consumption - production) / denom;
  s = Math.max(MIN_SCARCITY, Math.min(MAX_SCARCITY, s));
  return s;
}

/**
 * Cache scarcity per (world, resource) into regional_scarcity. Runs from
 * the heartbeat once per pass.
 */
export function refreshScarcityCache(db, worldId) {
  if (!db || !worldId) return { ok: false, reason: "no_world" };
  const all = [...RAW_RESOURCES, ...FINISHED_GOODS];
  let written = 0;
  for (const resource of all) {
    const s = computeRegionalScarcity(db, worldId, resource);
    try {
      db.prepare(`
        INSERT INTO regional_scarcity (world_id, resource_kind, scarcity, computed_at)
        VALUES (?, ?, ?, unixepoch())
        ON CONFLICT(world_id, resource_kind) DO UPDATE SET
          scarcity = excluded.scarcity,
          computed_at = excluded.computed_at
      `).run(worldId, resource, s);
      written++;
    } catch { /* table may not exist on partial migration */ }
  }
  return { ok: true, written };
}

/**
 * Price modulator: 1.0 + scarcity × 0.5. Bounded [0.75, 1.5].
 * Marketplace listings (NPC + player) multiply their base price by this.
 */
export function priceModulator(db, worldId, resourceKind) {
  if (!db || !worldId || !resourceKind) return 1.0;
  try {
    const r = db.prepare(`SELECT scarcity FROM regional_scarcity WHERE world_id = ? AND resource_kind = ?`).get(worldId, resourceKind);
    if (!r) return 1.0;
    return 1.0 + Number(r.scarcity || 0) * 0.5;
  } catch { return 1.0; }
}

// ── Activity dispatch (called by the heartbeat) ─────────────────────────────

/**
 * Dispatch by activity_kind from npc_routine_state. NPCs only act when
 * arrived. Returns a small action object describing what happened.
 */
export function dispatchEconomicAction(db, npc, activityKind) {
  switch (activityKind) {
    case "gather":  return performGather(db, npc);
    case "craft":   return performCraft(db, npc);
    case "trade":   return performTrade(db, npc);
    case "rest":    return consumePersonalNeeds(db, npc);
    default:        return { ok: false, reason: "non_economic_activity" };
  }
}

export const _internal = {
  RAW_RESOURCES,
  FINISHED_GOODS,
  ARCHETYPE_GATHER_TARGETS,
  ARCHETYPE_CRAFT_RECIPES,
  NEED_CONSUMPTION,
  SCARCITY_WINDOW_S,
  MAX_SCARCITY,
  MIN_SCARCITY,
  seededFloat,
  pickFromArray,
};

// Quiet export so tooling sees this module's logger usage tag.
export const _logger = logger;
