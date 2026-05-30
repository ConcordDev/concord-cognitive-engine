// server/lib/npc-labor-world.js
//
// Living Society — Phase 2: occupation → durable, walkable world mutation
// (not just ledger rows). This is the Medieval Dynasty primitive — you watch a
// building rise, a field grow, a hillside deplete because NPCs worked.
//
// Each function is idempotent-per-tick (progress capped) and writes a
// per-world table, so it runs inside the scope:'world' economy heartbeat.
// Resource gather now DEPLETES a node instead of minting from nothing.

const CONSTRUCT_RATE_PCT = Number(process.env.CONCORD_CONSTRUCT_RATE_PCT) || 12; // % per work block
const LOG_AMOUNT = Number(process.env.CONCORD_NPC_LOG_AMOUNT) || 8;
const MINE_AMOUNT = Number(process.env.CONCORD_NPC_MINE_AMOUNT) || 6;
const WORK_RADIUS = 40; // metres — NPC works the nearest target within this

function npcPos(npc) {
  let loc = npc.current_location || npc.spawn_location;
  if (typeof loc === "string") { try { loc = JSON.parse(loc); } catch { loc = null; } }
  return { x: Number(loc?.x ?? npc.x ?? 0), z: Number(loc?.z ?? npc.z ?? 0) };
}

function addNpcInventory(db, npcId, kind, delta) {
  try {
    db.prepare(`
      INSERT INTO npc_inventory (npc_id, resource_kind, quantity, updated_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(npc_id, resource_kind) DO UPDATE SET
        quantity = MAX(0, npc_inventory.quantity + ?), updated_at = unixepoch()
    `).run(npcId, kind, Math.max(0, delta), delta);
  } catch { /* npc_inventory absent */ }
}

/**
 * Raise a building. Picks a nearby in-progress building in the NPC's world,
 * accrues construction_progress_pct, and flips state → standing (or
 * build_target_state) at 100%. Idempotent: capped at 100, no-op once standing.
 */
export function performConstruction(db, npc, buildingId = null) {
  if (!db || !npc?.world_id) return { ok: false, reason: "missing_inputs" };
  const { x, z } = npcPos(npc);
  let b = null;
  try {
    if (buildingId) {
      b = db.prepare(`SELECT id, state, construction_progress_pct, build_target_state, x, z FROM world_buildings WHERE id = ? AND world_id = ?`).get(buildingId, npc.world_id);
    } else {
      b = db.prepare(`
        SELECT id, state, construction_progress_pct, build_target_state, x, z
        FROM world_buildings
        WHERE world_id = ? AND (state = 'construction' OR COALESCE(construction_progress_pct,0) < 100 AND state = 'construction')
        ORDER BY ((x-?)*(x-?) + (z-?)*(z-?)) ASC LIMIT 1
      `).get(npc.world_id, x, x, z, z);
    }
  } catch { return { ok: false, reason: "no_buildings_table" }; }
  if (!b) return { ok: false, reason: "no_construction_site" };
  if (b.state !== "construction") return { ok: false, reason: "not_under_construction" };

  const prev = Number(b.construction_progress_pct) || 0;
  const next = Math.min(100, prev + CONSTRUCT_RATE_PCT);
  const completed = next >= 100;
  const target = b.build_target_state || "standing";
  try {
    if (completed) {
      db.prepare(`UPDATE world_buildings SET construction_progress_pct = 100, state = ?, health_pct = 1.0 WHERE id = ?`).run(target, b.id);
    } else {
      db.prepare(`UPDATE world_buildings SET construction_progress_pct = ? WHERE id = ?`).run(next, b.id);
    }
  } catch (e) { return { ok: false, reason: "persist_failed", error: e?.message }; }
  return { ok: true, action: "build", buildingId: b.id, progress: next, completed, newState: completed ? target : "construction" };
}

/**
 * Tend a field. Advances the nearest unripe crop one growth stage. (NPC labor
 * accelerates growth beyond the passive season tick.) Idempotent: capped at
 * stage 3 (ripe).
 */
export function performFarming(db, npc, claimId = null) {
  if (!db || !npc) return { ok: false, reason: "missing_inputs" };
  let crop = null;
  try {
    if (claimId) {
      crop = db.prepare(`SELECT claim_id, tile_x, tile_y, growth_stage FROM claim_crops WHERE claim_id = ? AND growth_stage < 3 ORDER BY growth_stage DESC LIMIT 1`).get(claimId);
    } else {
      crop = db.prepare(`SELECT claim_id, tile_x, tile_y, growth_stage FROM claim_crops WHERE growth_stage < 3 ORDER BY growth_stage DESC LIMIT 1`).get();
    }
  } catch { return { ok: false, reason: "no_crops_table" }; }
  if (!crop) return { ok: false, reason: "no_unripe_crop" };
  const next = Math.min(3, (Number(crop.growth_stage) || 0) + 1);
  try {
    db.prepare(`UPDATE claim_crops SET growth_stage = ?, watered_at = unixepoch(), updated_at = unixepoch() WHERE claim_id = ? AND tile_x = ? AND tile_y = ?`)
      .run(next, crop.claim_id, crop.tile_x, crop.tile_y);
  } catch (e) { return { ok: false, reason: "persist_failed", error: e?.message }; }
  return { ok: true, action: "farm", claimId: crop.claim_id, tile: [crop.tile_x, crop.tile_y], stage: next, ripe: next >= 3 };
}

function depleteNode(db, npc, nodeTypes, amount, yieldKind) {
  if (!db || !npc?.world_id) return { ok: false, reason: "missing_inputs" };
  const { x, z } = npcPos(npc);
  const placeholders = nodeTypes.map(() => "?").join(",");
  let node = null;
  try {
    node = db.prepare(`
      SELECT id, resource_id, quantity_remaining, node_type
      FROM world_resource_nodes
      WHERE world_id = ? AND node_type IN (${placeholders}) AND is_depleted = 0 AND quantity_remaining > 0
      ORDER BY ((x-?)*(x-?) + (z-?)*(z-?)) ASC LIMIT 1
    `).get(npc.world_id, ...nodeTypes, x, x, z, z);
  } catch { return { ok: false, reason: "no_nodes_table" }; }
  if (!node) return { ok: false, reason: "no_node" };
  const taken = Math.min(amount, node.quantity_remaining);
  const remaining = node.quantity_remaining - taken;
  const depleted = remaining <= 0;
  try {
    if (depleted) {
      db.prepare(`UPDATE world_resource_nodes SET quantity_remaining = 0, is_depleted = 1, respawn_at = unixepoch() + respawn_hours*3600, last_gathered_by = ?, last_gathered_at = unixepoch() WHERE id = ?`).run(npc.id, node.id);
    } else {
      db.prepare(`UPDATE world_resource_nodes SET quantity_remaining = ?, last_gathered_by = ?, last_gathered_at = unixepoch() WHERE id = ?`).run(remaining, npc.id, node.id);
    }
  } catch (e) { return { ok: false, reason: "persist_failed", error: e?.message }; }
  addNpcInventory(db, npc.id, yieldKind, taken);
  return { ok: true, nodeId: node.id, taken, remaining, depleted, yield: yieldKind };
}

/** Fell trees: deplete a tree node, yield lumber. */
export function performLogging(db, npc) {
  const r = depleteNode(db, npc, ["tree"], LOG_AMOUNT, "wood");
  return r.ok ? { ...r, action: "log" } : r;
}

/** Quarry/mine: deplete an ore/stone node, yield ore. */
export function performMining(db, npc) {
  const r = depleteNode(db, npc, ["ore_vein", "stone", "crystal"], MINE_AMOUNT, "ore");
  return r.ok ? { ...r, action: "mine" } : r;
}

export const LABOR_CONSTANTS = Object.freeze({ CONSTRUCT_RATE_PCT, LOG_AMOUNT, MINE_AMOUNT, WORK_RADIUS });
