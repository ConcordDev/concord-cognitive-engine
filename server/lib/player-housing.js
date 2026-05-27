// server/lib/player-housing.js
//
// Phase BA1 — wire the existing substrate into a "this is my house"
// abstraction. The pieces all already exist; this is the join.
//
// Contract:
//   - A house is the join of (land_claim, world_building, building_rooms+).
//   - Player must own the land_claim to claim the building as their house.
//   - Building must be inside the land_claim's circle.
//   - Decoration (place/remove furniture) requires house ownership.
//   - Lock tier change requires house ownership; delegates to world-crime
//     for the underlying building_rooms lock_tier write.
//   - Visibility gate: private = owner only, friends = friend list,
//     public = anyone (still needs lockpicking to enter locked rooms).
//
// Destructibility + lockpicking are NOT in this file. They live in
// world-crime.js and embodied/skill-environment.js — combat inside a
// house damages the building via applyStructuralStress as it would
// anywhere else (the user's explicit design: houses inherit world
// destructibility).

import crypto from "node:crypto";
import logger from "../logger.js";

const VALID_VISIBILITIES = new Set(["private", "friends", "public"]);

/**
 * Claim a building inside a land-claim as your house. Idempotent on
 * (land_claim_id, building_id) — re-claiming returns the existing row.
 */
export function claimHouse(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const { landClaimId, buildingId, name } = opts;
  if (!landClaimId || !buildingId) return { ok: false, error: "missing_inputs" };

  try {
    const claim = db.prepare(`
      SELECT id, owner_user_id, world_id, anchor_x, anchor_z, radius_m, status
      FROM land_claims WHERE id = ?
    `).get(landClaimId);
    if (!claim) return { ok: false, error: "no_land_claim" };
    if (claim.owner_user_id !== userId) return { ok: false, error: "not_claim_owner" };
    if (claim.status !== "active") return { ok: false, error: "claim_inactive" };

    const building = db.prepare(`
      SELECT id, world_id, x, z FROM world_buildings WHERE id = ?
    `).get(buildingId);
    if (!building) return { ok: false, error: "no_building" };
    if (building.world_id !== claim.world_id) return { ok: false, error: "world_mismatch" };

    // Building must be inside the claim's circle.
    const dx = building.x - claim.anchor_x;
    const dz = building.z - claim.anchor_z;
    if (Math.hypot(dx, dz) > claim.radius_m) {
      return { ok: false, error: "building_outside_claim" };
    }

    // Idempotency on (land_claim_id, building_id).
    const existing = db.prepare(`
      SELECT id FROM player_houses WHERE land_claim_id = ? AND building_id = ?
    `).get(landClaimId, buildingId);
    if (existing) return { ok: true, houseId: existing.id, alreadyExisted: true };

    const id = `ph_${crypto.randomBytes(8).toString("hex")}`;
    db.prepare(`
      INSERT INTO player_houses
        (id, user_id, world_id, land_claim_id, building_id, name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, claim.world_id, landClaimId, buildingId, name || "My House");

    // Transfer building ownership to the user if not already theirs.
    db.prepare(`
      UPDATE world_buildings SET owner_type = 'player', owner_id = ?
      WHERE id = ? AND (owner_id IS NULL OR owner_type != 'player')
    `).run(userId, buildingId);

    logger.info?.("player-housing", "house_claimed", { id, userId, buildingId });
    return { ok: true, houseId: id, alreadyExisted: false };
  } catch (err) {
    return { ok: false, error: err?.message || "db_error" };
  }
}

/**
 * Place a furniture item in a room with per-coord placement. Idempotent
 * on (roomId, itemId) — re-place updates position/rotation. Always
 * touches last_decorated_at on the house so snapshot capture knows to
 * re-serialize.
 */
export function placeFurniture(db, userId, houseId, roomId, item) {
  if (!db || !userId || !houseId || !roomId || !item?.itemId) {
    return { ok: false, error: "missing_inputs" };
  }
  const house = _ownedHouse(db, userId, houseId);
  if (!house.ok) return house;

  try {
    const room = db.prepare(`
      SELECT id, building_id, furniture_layout_json
      FROM building_rooms WHERE id = ?
    `).get(roomId);
    if (!room) return { ok: false, error: "no_room" };
    if (room.building_id !== house.row.building_id) return { ok: false, error: "room_not_in_house" };

    const layout = _parseLayout(room.furniture_layout_json);
    const idx = layout.findIndex(f => f.itemId === item.itemId);
    const entry = {
      itemId: String(item.itemId),
      x: Number(item.x) || 0,
      y: Number(item.y) || 0,
      z: Number(item.z) || 0,
      rot: Number(item.rot) || 0,
    };
    if (idx >= 0) layout[idx] = entry; else layout.push(entry);

    db.prepare(`
      UPDATE building_rooms SET furniture_layout_json = ? WHERE id = ?
    `).run(JSON.stringify(layout), roomId);
    db.prepare(`
      UPDATE player_houses SET last_decorated_at = unixepoch() WHERE id = ?
    `).run(houseId);

    return { ok: true, layoutSize: layout.length };
  } catch (err) {
    return { ok: false, error: err?.message || "db_error" };
  }
}

/**
 * Remove a furniture item from a room by itemId. Idempotent — missing
 * itemId returns ok:true with removed:false.
 */
export function removeFurniture(db, userId, houseId, roomId, itemId) {
  if (!db || !userId || !houseId || !roomId || !itemId) {
    return { ok: false, error: "missing_inputs" };
  }
  const house = _ownedHouse(db, userId, houseId);
  if (!house.ok) return house;

  try {
    const room = db.prepare(`
      SELECT furniture_layout_json, building_id FROM building_rooms WHERE id = ?
    `).get(roomId);
    if (!room) return { ok: false, error: "no_room" };
    if (room.building_id !== house.row.building_id) return { ok: false, error: "room_not_in_house" };

    const layout = _parseLayout(room.furniture_layout_json);
    const next = layout.filter(f => f.itemId !== itemId);
    const removed = next.length !== layout.length;
    if (removed) {
      db.prepare(`
        UPDATE building_rooms SET furniture_layout_json = ? WHERE id = ?
      `).run(JSON.stringify(next), roomId);
      db.prepare(`
        UPDATE player_houses SET last_decorated_at = unixepoch() WHERE id = ?
      `).run(houseId);
    }
    return { ok: true, removed };
  } catch (err) {
    return { ok: false, error: err?.message || "db_error" };
  }
}

/** Set house visibility (private|friends|public). */
export function setVisibility(db, userId, houseId, visibility) {
  if (!VALID_VISIBILITIES.has(visibility)) return { ok: false, error: "invalid_visibility" };
  const house = _ownedHouse(db, userId, houseId);
  if (!house.ok) return house;
  try {
    db.prepare(`UPDATE player_houses SET visibility = ? WHERE id = ?`)
      .run(visibility, houseId);
    return { ok: true, visibility };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/** Owner toggle for live visits (snapshot is always allowed if visible). */
export function setAllowLiveVisits(db, userId, houseId, allow) {
  const house = _ownedHouse(db, userId, houseId);
  if (!house.ok) return house;
  try {
    db.prepare(`UPDATE player_houses SET allow_live_visits = ? WHERE id = ?`)
      .run(allow ? 1 : 0, houseId);
    return { ok: true, allow: !!allow };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Set lock tier on a specific room of a house. Delegates to the
 * existing building_rooms lock_tier column (mig 065) so lockpicking
 * via world-crime.js#attemptLockpick works against it unchanged.
 */
export function setLockTier(db, userId, houseId, roomId, lockTier) {
  const tier = Math.max(0, Math.min(5, Math.floor(Number(lockTier) || 0)));
  const house = _ownedHouse(db, userId, houseId);
  if (!house.ok) return house;
  try {
    const room = db.prepare(`SELECT building_id FROM building_rooms WHERE id = ?`).get(roomId);
    if (!room) return { ok: false, error: "no_room" };
    if (room.building_id !== house.row.building_id) return { ok: false, error: "room_not_in_house" };
    const lockState = tier > 0 ? "locked" : "open";
    db.prepare(`
      UPDATE building_rooms SET lock_tier = ?, lock_state = ?, is_public = ?
      WHERE id = ?
    `).run(tier, lockState, tier > 0 ? 0 : 1, roomId);
    return { ok: true, lockTier: tier, lockState };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/** Get a house with its rooms + per-coord furniture layout (back-compat: returns flat furniture too). */
export function getHouse(db, houseId) {
  if (!db || !houseId) return null;
  try {
    const house = db.prepare(`SELECT * FROM player_houses WHERE id = ?`).get(houseId);
    if (!house) return null;

    const rooms = db.prepare(`
      SELECT id, room_type, name, width, depth, height, x_offset, z_offset,
             floor, capacity, lock_tier, lock_state, is_public,
             furniture, furniture_layout_json
      FROM building_rooms WHERE building_id = ?
      ORDER BY floor ASC, x_offset ASC
    `).all(house.building_id);

    return {
      ...house,
      rooms: rooms.map(r => ({
        ...r,
        furniture: _tryParse(r.furniture, []),
        furniture_layout: _parseLayout(r.furniture_layout_json),
      })),
    };
  } catch { return null; }
}

export function listMyHouses(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, name, world_id, building_id, land_claim_id, visibility,
             allow_live_visits, created_at, last_decorated_at
      FROM player_houses WHERE user_id = ?
      ORDER BY last_decorated_at DESC
    `).all(userId);
  } catch { return []; }
}

/**
 * Check whether a visitor is allowed inside the house at all. Does NOT
 * check per-room lock state — that's world-crime.js#checkRoomAccess.
 */
export function canVisit(db, visitorId, houseId, opts = {}) {
  try {
    const house = db.prepare(`
      SELECT user_id, visibility, allow_live_visits FROM player_houses WHERE id = ?
    `).get(houseId);
    if (!house) return { allowed: false, reason: "no_house" };
    if (house.user_id === visitorId) return { allowed: true, mode: "owner" };
    if (house.visibility === "private") return { allowed: false, reason: "private" };
    if (house.visibility === "friends") {
      if (!opts.isFriend) return { allowed: false, reason: "not_friend" };
    }
    const mode = house.allow_live_visits ? "live" : "snapshot";
    return { allowed: true, mode };
  } catch (err) {
    return { allowed: false, reason: err?.message || "db_error" };
  }
}

// ── helpers ─────────────────────────────────────────────────────────────

function _ownedHouse(db, userId, houseId) {
  const row = db.prepare(`SELECT * FROM player_houses WHERE id = ?`).get(houseId);
  if (!row) return { ok: false, error: "no_house" };
  if (row.user_id !== userId) return { ok: false, error: "not_owner" };
  return { ok: true, row };
}

function _parseLayout(str) {
  if (!str) return [];
  try {
    const arr = JSON.parse(str);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function _tryParse(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}
