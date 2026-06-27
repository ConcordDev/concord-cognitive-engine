// server/domains/housing.js
//
// Phase BA1/BA2 — macro surface for the player-housing lens.
//
// The `/lenses/housing` page reaches the substrate through the REST
// routes under /api/housing/*. These macros expose the SAME real
// player-housing.js + house-visit.js surface through runMacro so the
// generic lens shell, the ⌘K palette, and the Orchestrated Invariant
// Engine (contracts: housing.*) can reach it.
//
// Every handler delegates to the real lib — there is NO duplicated
// housing logic in this file. Ownership checks, the inside-the-claim
// geometry, the per-coord furniture_layout_json write, the snapshot
// debounce, and the world-crime lock-tier write all live in
// server/lib/player-housing.js + server/lib/house-visit.js; this file
// only adapts the (ctx, input) macro calling convention onto those
// exported functions and shapes a `{ ok, ... }` envelope.
//
// All write paths are owner-gated inside the lib (it checks
// row.user_id === userId), so a macro caller can only mutate their own
// house. Read paths (get / public) are intentionally unauthenticated —
// they mirror the public REST GET routes (a public house is meant to be
// browsable; getHouse on a private house still reveals only structure,
// never the owner's friend list or snapshot secrets).

import {
  claimHouse,
  listMyHouses,
  getHouse,
  placeFurniture,
  removeFurniture,
  setVisibility,
  setAllowLiveVisits,
  setLockTier,
} from "../lib/player-housing.js";
import { requestVisit } from "../lib/house-visit.js";

const VISIBILITIES = new Set(["private", "friends", "public"]);

export default function registerHousingMacros(register) {
  /**
   * housing.mine — list the actor's houses.
   * input: { userId? } (defaults to ctx.actor.userId)
   */
  register("housing", "mine", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, houses: listMyHouses(db, userId) };
  }, { note: "list the actor's houses" });

  /**
   * housing.get — a single house with rooms + per-coord furniture layout.
   * input: { houseId }
   */
  register("housing", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.houseId) return { ok: false, reason: "missing_house_id" };
    const house = getHouse(db, input.houseId);
    if (!house) return { ok: false, reason: "no_house" };
    return { ok: true, house };
  }, { note: "house detail with rooms + furniture layout" });

  /**
   * housing.public — list public houses in a world (browse surface).
   * input: { worldId, limit? }
   */
  register("housing", "public", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.worldId) return { ok: false, reason: "missing_world_id" };
    const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 100);
    try {
      const houses = db.prepare(`
        SELECT id, user_id, name, building_id, visibility, allow_live_visits,
               last_decorated_at
        FROM player_houses
        WHERE world_id = ? AND visibility = 'public'
        ORDER BY last_decorated_at DESC
        LIMIT ?
      `).all(input.worldId, limit);
      return { ok: true, houses };
    } catch (err) {
      return { ok: false, reason: err?.message || "db_error" };
    }
  }, { note: "public houses in a world" });

  /**
   * housing.claim — claim a building inside a land-claim as a house.
   * input: { landClaimId, buildingId, name? }
   */
  register("housing", "claim", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return claimHouse(db, userId, {
      landClaimId: input.landClaimId,
      buildingId: input.buildingId,
      name: input.name,
    });
  }, { note: "claim a building inside a land-claim as your house" });

  /**
   * housing.place_furniture — place/move a furniture item in a room.
   * input: { houseId, roomId, item: { itemId, x, y, z, rot } }
   */
  register("housing", "place_furniture", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return placeFurniture(db, userId, input.houseId, input.roomId, input.item || {});
  }, { note: "place / move a furniture item (per-coord)" });

  /**
   * housing.remove_furniture — remove a furniture item from a room.
   * input: { houseId, roomId, itemId }
   */
  register("housing", "remove_furniture", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return removeFurniture(db, userId, input.houseId, input.roomId, input.itemId);
  }, { note: "remove a furniture item from a room" });

  /**
   * housing.set_visibility — set house visibility (private|friends|public).
   * input: { houseId, visibility }
   */
  register("housing", "set_visibility", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    if (!VISIBILITIES.has(input.visibility)) return { ok: false, reason: "invalid_visibility" };
    return setVisibility(db, userId, input.houseId, input.visibility);
  }, { note: "set house visibility" });

  /**
   * housing.set_live_visits — owner toggle for live (vs snapshot) visits.
   * input: { houseId, allow }
   */
  register("housing", "set_live_visits", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return setAllowLiveVisits(db, userId, input.houseId, Boolean(input.allow));
  }, { note: "toggle live visits on/off" });

  /**
   * housing.set_lock — set a room's lock tier (0..5). Delegates to the
   * building_rooms lock_tier column so world-crime lockpicking works
   * against it unchanged.
   * input: { houseId, roomId, lockTier }
   */
  register("housing", "set_lock", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return setLockTier(db, userId, input.houseId, input.roomId, input.lockTier);
  }, { note: "set a room's lock tier" });

  /**
   * housing.visit — request a visit (snapshot OR live, gated by
   * visibility + owner's allow_live_visits toggle).
   * input: { houseId, isFriend? }
   */
  register("housing", "visit", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return requestVisit(db, userId, input.houseId, { isFriend: Boolean(input.isFriend) });
  }, { note: "request a snapshot or live visit" });
}
