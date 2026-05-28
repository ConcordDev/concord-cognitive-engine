// server/lib/factory.js
//
// Phase CC4 — factory automation (claim-bounded).
//
// Tile grid lives inside a land claim. Three entity kinds:
//   - chest: holds items
//   - belt:  moves one item per tick to its connected target
//   - crafter: consumes inputs from incoming belt, produces outputs
//
// tickClaimFactory advances every belt one step per heartbeat.

import crypto from "node:crypto";
import logger from "../logger.js";

const VALID_TYPES = new Set(["chest", "belt", "crafter"]);

export function placeEntity(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const { claimId, entityType, tileX, tileY, rotation = 0, config = {} } = opts;
  if (!claimId || !entityType || tileX == null || tileY == null) {
    return { ok: false, error: "missing_inputs" };
  }
  if (!VALID_TYPES.has(entityType)) return { ok: false, error: "invalid_type" };
  if (typeof opts.isOwner === "function" && !opts.isOwner(userId, claimId)) {
    return { ok: false, error: "not_claim_owner" };
  }
  try {
    const id = `ent_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO claim_entities
        (id, claim_id, entity_type, tile_x, tile_y, rotation, config_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, claimId, entityType, tileX, tileY,
      Math.max(0, Math.min(3, Math.floor(rotation))),
      JSON.stringify(config));
    return { ok: true, entityId: id };
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE")) {
      return { ok: false, error: "tile_occupied" };
    }
    return { ok: false, error: err?.message };
  }
}

export function removeEntity(db, userId, entityId, opts = {}) {
  if (!db || !userId || !entityId) return { ok: false, error: "missing_inputs" };
  try {
    const e = db.prepare(`SELECT claim_id FROM claim_entities WHERE id = ?`).get(entityId);
    if (!e) return { ok: false, error: "no_entity" };
    if (typeof opts.isOwner === "function" && !opts.isOwner(userId, e.claim_id)) {
      return { ok: false, error: "not_claim_owner" };
    }
    db.prepare(`DELETE FROM claim_entity_inventory WHERE entity_id = ?`).run(entityId);
    db.prepare(`DELETE FROM claim_entities WHERE id = ?`).run(entityId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function connectEntities(db, userId, sourceId, targetId, opts = {}) {
  if (!db || !userId || !sourceId || !targetId) return { ok: false, error: "missing_inputs" };
  try {
    const src = db.prepare(`SELECT claim_id, connections_json FROM claim_entities WHERE id = ?`).get(sourceId);
    const tgt = db.prepare(`SELECT claim_id FROM claim_entities WHERE id = ?`).get(targetId);
    if (!src || !tgt) return { ok: false, error: "no_entity" };
    if (src.claim_id !== tgt.claim_id) return { ok: false, error: "cross_claim" };
    if (typeof opts.isOwner === "function" && !opts.isOwner(userId, src.claim_id)) {
      return { ok: false, error: "not_claim_owner" };
    }
    const conns = JSON.parse(src.connections_json);
    if (!conns.includes(targetId)) {
      conns.push(targetId);
      db.prepare(`UPDATE claim_entities SET connections_json = ? WHERE id = ?`)
        .run(JSON.stringify(conns), sourceId);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function depositToEntity(db, entityId, item) {
  if (!db || !entityId || !item?.itemDescriptor) return { ok: false, error: "missing_inputs" };
  const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
  try {
    db.prepare(`
      INSERT INTO claim_entity_inventory (entity_id, item_descriptor, quantity)
      VALUES (?, ?, ?)
      ON CONFLICT(entity_id, item_descriptor) DO UPDATE SET
        quantity = quantity + excluded.quantity
    `).run(entityId, item.itemDescriptor, qty);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Tick the factory in a claim: each belt moves one item along its
 * connections. Crafters consume inputs and produce outputs based on
 * config_json.recipe.
 */
export function tickClaimFactory(db, claimId) {
  if (!db || !claimId) return { ok: false, error: "missing_inputs" };
  try {
    const belts = db.prepare(`
      SELECT id, connections_json FROM claim_entities
      WHERE claim_id = ? AND entity_type = 'belt'
    `).all(claimId);

    let moved = 0;
    for (const belt of belts) {
      const conns = JSON.parse(belt.connections_json);
      if (conns.length === 0) continue;
      const target = conns[0];
      // Move one item from the belt's inventory to the target.
      const stack = db.prepare(`
        SELECT item_descriptor, quantity FROM claim_entity_inventory
        WHERE entity_id = ? AND quantity > 0
        LIMIT 1
      `).get(belt.id);
      if (!stack) continue;
      db.prepare(`
        UPDATE claim_entity_inventory SET quantity = quantity - 1
        WHERE entity_id = ? AND item_descriptor = ?
      `).run(belt.id, stack.item_descriptor);
      db.prepare(`
        INSERT INTO claim_entity_inventory (entity_id, item_descriptor, quantity)
        VALUES (?, ?, 1)
        ON CONFLICT DO UPDATE SET quantity = quantity + 1
      `).run(target, stack.item_descriptor);
      moved++;
    }

    // Crafters: consume inputs, produce outputs.
    const crafters = db.prepare(`
      SELECT id, config_json FROM claim_entities WHERE claim_id = ? AND entity_type = 'crafter'
    `).all(claimId);
    let crafted = 0;
    for (const c of crafters) {
      let recipe;
      try { recipe = JSON.parse(c.config_json).recipe; } catch { continue; }
      if (!recipe?.inputs || !recipe?.output) continue;
      const haveAll = recipe.inputs.every(inp => {
        const stack = db.prepare(`
          SELECT quantity FROM claim_entity_inventory
          WHERE entity_id = ? AND item_descriptor = ?
        `).get(c.id, inp.itemDescriptor);
        return (stack?.quantity || 0) >= inp.quantity;
      });
      if (!haveAll) continue;
      for (const inp of recipe.inputs) {
        db.prepare(`
          UPDATE claim_entity_inventory SET quantity = quantity - ?
          WHERE entity_id = ? AND item_descriptor = ?
        `).run(inp.quantity, c.id, inp.itemDescriptor);
      }
      db.prepare(`
        INSERT INTO claim_entity_inventory (entity_id, item_descriptor, quantity)
        VALUES (?, ?, ?)
        ON CONFLICT DO UPDATE SET quantity = quantity + excluded.quantity
      `).run(c.id, recipe.output.itemDescriptor, Number(recipe.output.quantity) || 1);
      crafted++;
    }
    if (moved > 0 || crafted > 0) {
      logger.info?.("factory", "tick", { claimId, moved, crafted });
    }
    return { ok: true, moved, crafted };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listEntities(db, claimId) {
  if (!db || !claimId) return [];
  try {
    return db.prepare(`
      SELECT id, entity_type, tile_x, tile_y, rotation, connections_json, config_json
      FROM claim_entities WHERE claim_id = ?
    `).all(claimId);
  } catch { return []; }
}

export function getInventory(db, entityId) {
  if (!db || !entityId) return [];
  try {
    return db.prepare(`
      SELECT item_descriptor, quantity FROM claim_entity_inventory
      WHERE entity_id = ? AND quantity > 0
    `).all(entityId);
  } catch { return []; }
}
