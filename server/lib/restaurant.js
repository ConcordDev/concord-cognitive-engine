// server/lib/restaurant.js
//
// Phase CB4 — restaurant management.
//
// Open a restaurant in your building, NPC customers arrive (driven by
// a heartbeat or manual `tickArrivals`), they order, you serve in time
// or the order expires. Diner-Dash pressure: orders expire 5 min after
// being placed by default.

import crypto from "node:crypto";
import logger from "../logger.js";

// Phase E1 — balance dials are env-overridable. Defaults are
// playtest-tunable; the canonical doc is `docs/BALANCE_DIALS.md`.
const DEFAULT_ORDER_TTL_S = Number(process.env.CONCORD_RESTAURANT_ORDER_TTL_S) || (5 * 60);
const BASE_PRICE_CC = Number(process.env.CONCORD_RESTAURANT_BASE_PRICE_CC) || 15;
// T3.4 — adopted the G3.1 sim recommendation (audit/balance/restaurant-tips.json):
// fast 0.20 / ok 0.15 gives steadier earnings (incomeSd 1.42, expiredRatio 0)
// than the burst-y 0.30/0.10 without changing total payout meaningfully.
const TIP_FRACTION_FAST = Number(process.env.CONCORD_RESTAURANT_TIP_FRACTION_FAST) || 0.20; // within 30s
const TIP_FRACTION_OK = Number(process.env.CONCORD_RESTAURANT_TIP_FRACTION_OK) || 0.15;     // within ttl
const TIP_FRACTION_SLOW = Number(process.env.CONCORD_RESTAURANT_TIP_FRACTION_SLOW) || 0;

// E5 — Diner-Dash batching combo. Serving orders in quick succession builds a
// tip multiplier (the satisfying "rush" loop). Resets when you let the window
// lapse. In-memory per restaurant — a session feel mechanic, not persisted.
const COMBO_WINDOW_S = Number(process.env.CONCORD_RESTAURANT_COMBO_WINDOW_S) || 12;
const COMBO_BONUS_PER = Number(process.env.CONCORD_RESTAURANT_COMBO_BONUS) || 0.08; // +8% tip per combo step
const COMBO_MAX = Number(process.env.CONCORD_RESTAURANT_COMBO_MAX) || 5;
const _comboState = new Map(); // restaurantId → { count, lastServedAt }

/** Advance/reset the batching combo for a restaurant. Returns the new count. */
function _bumpCombo(restaurantId, now) {
  const s = _comboState.get(restaurantId);
  const count = (s && now - s.lastServedAt <= COMBO_WINDOW_S) ? Math.min(COMBO_MAX, s.count + 1) : 1;
  _comboState.set(restaurantId, { count, lastServedAt: now });
  return count;
}
/** Test/▶ reset hook. */
export function _resetComboState() { _comboState.clear(); }

const DISH_CATALOG = Object.freeze([
  "stew", "roast", "soup", "bread", "salad", "pastry", "ale", "tea",
]);

export function openRestaurant(db, ownerUserId, opts = {}) {
  if (!db || !ownerUserId) return { ok: false, error: "missing_inputs" };
  const { worldId, buildingId, name } = opts;
  if (!worldId) return { ok: false, error: "missing_worldId" };
  try {
    const id = `rst_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO restaurants (id, owner_user_id, world_id, building_id, name, opened_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
    `).run(id, ownerUserId, worldId, buildingId || null, name || "Diner");
    logger.info?.("restaurant", "opened", { id, ownerUserId });
    return { ok: true, restaurantId: id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function closeRestaurant(db, restaurantId, ownerUserId) {
  if (!db || !restaurantId || !ownerUserId) return { ok: false, error: "missing_inputs" };
  try {
    const r = db.prepare(`SELECT owner_user_id, closed_at FROM restaurants WHERE id = ?`).get(restaurantId);
    if (!r) return { ok: false, error: "no_restaurant" };
    if (r.owner_user_id !== ownerUserId) return { ok: false, error: "not_owner" };
    if (r.closed_at) return { ok: false, error: "already_closed" };
    db.prepare(`UPDATE restaurants SET closed_at = unixepoch() WHERE id = ?`).run(restaurantId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Place a customer order. Caller (heartbeat) drives this; in tests the
 * test code drives it directly.
 */
export function placeOrder(db, restaurantId, opts = {}) {
  if (!db || !restaurantId) return { ok: false, error: "missing_inputs" };
  const { customerNpcId, dishId, ttlSeconds = DEFAULT_ORDER_TTL_S } = opts;
  if (!customerNpcId) return { ok: false, error: "missing_customer" };
  const dish = dishId || DISH_CATALOG[Math.floor(Math.random() * DISH_CATALOG.length)];

  try {
    const r = db.prepare(`SELECT closed_at FROM restaurants WHERE id = ?`).get(restaurantId);
    if (!r) return { ok: false, error: "no_restaurant" };
    if (r.closed_at) return { ok: false, error: "restaurant_closed" };

    const id = `ord_${crypto.randomBytes(6).toString("hex")}`;
    const expiresAt = Math.floor(Date.now() / 1000) + Math.max(30, ttlSeconds);
    db.prepare(`
      INSERT INTO restaurant_orders
        (id, restaurant_id, customer_npc_id, dish_id, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, restaurantId, customerNpcId, dish, expiresAt);
    return { ok: true, orderId: id, dishId: dish, expiresAt };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function serveOrder(db, ownerUserId, orderId) {
  if (!db || !ownerUserId || !orderId) return { ok: false, error: "missing_inputs" };
  try {
    const o = db.prepare(`
      SELECT o.*, r.owner_user_id
      FROM restaurant_orders o JOIN restaurants r ON r.id = o.restaurant_id
      WHERE o.id = ?
    `).get(orderId);
    if (!o) return { ok: false, error: "no_order" };
    if (o.owner_user_id !== ownerUserId) return { ok: false, error: "not_owner" };
    if (o.status !== "pending") return { ok: false, error: `order_${o.status}` };

    const now = Math.floor(Date.now() / 1000);
    if (o.expires_at <= now) {
      db.prepare(`UPDATE restaurant_orders SET status = 'expired' WHERE id = ?`).run(orderId);
      db.prepare(`UPDATE restaurants SET orders_missed = orders_missed + 1 WHERE id = ?`).run(o.restaurant_id);
      return { ok: false, error: "expired" };
    }

    const waited = now - o.ordered_at;
    let tipFrac = TIP_FRACTION_SLOW;
    if (waited <= 30) tipFrac = TIP_FRACTION_FAST;
    else if (waited <= o.expires_at - o.ordered_at - 60) tipFrac = TIP_FRACTION_OK;

    const payment = BASE_PRICE_CC;
    // E5 — a serve only counts toward the combo if it earned a tip (served in
    // time); a 0-tip late serve breaks neither builds the rush.
    const combo = tipFrac > 0 ? _bumpCombo(o.restaurant_id, now) : 1;
    const comboMult = 1 + (combo - 1) * COMBO_BONUS_PER;
    const tip = Math.round(payment * tipFrac * comboMult * 100) / 100;
    const total = payment + tip;

    db.prepare(`
      UPDATE restaurant_orders
      SET status = 'served', served_at = ?, payment_cc = ?, tip_cc = ?
      WHERE id = ?
    `).run(now, payment, tip, orderId);

    db.prepare(`
      UPDATE restaurants
      SET orders_served = orders_served + 1,
          total_revenue = total_revenue + ?,
          total_tips = total_tips + ?
      WHERE id = ?
    `).run(payment, tip, o.restaurant_id);

    return { ok: true, payment, tip, total, tipFrac, combo, comboMult: Math.round(comboMult * 100) / 100 };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function sweepExpiredOrders(db) {
  if (!db) return { ok: false };
  try {
    const expired = db.prepare(`
      SELECT id, restaurant_id FROM restaurant_orders
      WHERE status = 'pending' AND expires_at <= unixepoch()
    `).all();
    const markExpired = db.prepare(`UPDATE restaurant_orders SET status = 'expired' WHERE id = ?`);
    const incMissed = db.prepare(`UPDATE restaurants SET orders_missed = orders_missed + 1 WHERE id = ?`);
    for (const o of expired) {
      markExpired.run(o.id);
      incMissed.run(o.restaurant_id);
    }
    return { ok: true, expired: expired.length };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listPendingOrders(db, restaurantId) {
  if (!db || !restaurantId) return [];
  try {
    return db.prepare(`
      SELECT id, customer_npc_id, dish_id, ordered_at, expires_at
      FROM restaurant_orders
      WHERE restaurant_id = ? AND status = 'pending'
      ORDER BY ordered_at ASC
    `).all(restaurantId);
  } catch { return []; }
}

export function getRestaurantSummary(db, restaurantId) {
  if (!db || !restaurantId) return null;
  try {
    return db.prepare(`SELECT * FROM restaurants WHERE id = ?`).get(restaurantId) || null;
  } catch { return null; }
}

export { DISH_CATALOG, BASE_PRICE_CC, DEFAULT_ORDER_TTL_S };
