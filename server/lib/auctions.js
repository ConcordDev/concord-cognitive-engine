// server/lib/auctions.js
//
// Phase V1 — auction engine. Time-bound bidding with optional buy-now.
//
// Anti-snipe: a bid landing in the last SNIPE_WINDOW_S seconds extends
// the auction by SNIPE_EXTEND_S seconds (default 60s each).
//
// Wallet holds: walletDebit when a bid is placed; walletCredit the
// prior leading bidder. Settlement transfers the item to the leader and
// payouts the seller minus the 5% platform fee.

import crypto from "node:crypto";
import logger from "../logger.js";

const SNIPE_WINDOW_S = Number(process.env.CONCORD_AUCTION_SNIPE_WINDOW_S) || 60;
const SNIPE_EXTEND_S = Number(process.env.CONCORD_AUCTION_SNIPE_EXTEND_S) || 60;
const PLATFORM_FEE_RATE = 0.05;

export function createAuction(db, sellerId, opts) {
  if (!db || !sellerId) return { ok: false, error: "missing_inputs" };
  const itemKind = opts?.itemKind === "inventory" ? "inventory" : "dtu";
  const itemId = String(opts?.itemId || "").trim();
  if (!itemId) return { ok: false, error: "item_id_required" };
  const startCc = Math.max(0, Number(opts?.startCc) || 0);
  const buyoutCc = opts?.buyoutCc != null ? Math.max(startCc, Number(opts.buyoutCc)) : null;
  const durationS = Math.min(Math.max(60, Number(opts?.durationS) || 3600), 86_400);
  const worldId = opts?.worldId || null;
  const title = String(opts?.title || "").slice(0, 120);

  const id = `auc_${crypto.randomBytes(6).toString("hex")}`;
  try {
    db.prepare(`
      INSERT INTO auctions
        (id, seller_user_id, world_id, item_kind, item_id, title, start_cc,
         current_bid_cc, buyout_cc, starts_at, ends_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, unixepoch(), unixepoch() + ?)
    `).run(id, sellerId, worldId, itemKind, itemId, title, startCc, buyoutCc, durationS);
    return { ok: true, auctionId: id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Place a bid. Validates: auction active, bid > current_bid, bid >= start_cc,
 * bidder != seller, wallet has funds. Refunds prior leader's hold.
 * Extends end time if within snipe window.
 *
 * Buy-now: if buyout_cc set AND bid >= buyout_cc, instantly settle.
 */
export function placeBid(db, auctionId, bidderId, amountCc) {
  if (!db || !auctionId || !bidderId) return { ok: false, error: "missing_inputs" };
  const amount = Number(amountCc) || 0;
  if (amount <= 0) return { ok: false, error: "invalid_amount" };

  const a = _getAuction(db, auctionId);
  if (!a) return { ok: false, error: "no_auction" };
  if (a.status !== "active") return { ok: false, error: "not_active" };
  if (a.seller_user_id === bidderId) return { ok: false, error: "cannot_bid_on_own" };
  if (a.ends_at <= Math.floor(Date.now() / 1000)) return { ok: false, error: "expired" };
  if (amount < a.start_cc) return { ok: false, error: "below_start" };
  if (amount <= a.current_bid_cc) return { ok: false, error: "must_exceed_current" };

  const tx = db.transaction(() => {
    // Debit the new bidder.
    const debit = _walletDebit(db, bidderId, amount, `auction_bid:${auctionId}`);
    if (!debit.ok) throw new Error("insufficient_funds");

    // Refund the prior leader (if any).
    if (a.leading_bidder_user_id && a.current_bid_cc > 0) {
      _walletCredit(db, a.leading_bidder_user_id, a.current_bid_cc, `auction_refund:${auctionId}`);
      try {
        db.prepare(`
          UPDATE auction_bids SET refunded_at = unixepoch()
          WHERE auction_id = ? AND bidder_user_id = ? AND refunded_at IS NULL
        `).run(auctionId, a.leading_bidder_user_id);
      } catch { /* refund column optional */ }
    }

    // Record the new bid.
    const bidId = `bid_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO auction_bids (id, auction_id, bidder_user_id, amount_cc)
      VALUES (?, ?, ?, ?)
    `).run(bidId, auctionId, bidderId, amount);

    // Update auction state.
    const now = Math.floor(Date.now() / 1000);
    const inSnipeWindow = (a.ends_at - now) <= SNIPE_WINDOW_S;
    const newEndsAt = inSnipeWindow ? a.ends_at + SNIPE_EXTEND_S : a.ends_at;
    db.prepare(`
      UPDATE auctions
      SET current_bid_cc = ?, leading_bidder_user_id = ?,
          bid_count = bid_count + 1, ends_at = ?
      WHERE id = ?
    `).run(amount, bidderId, newEndsAt, auctionId);
  });

  try {
    tx();
  } catch (err) {
    return { ok: false, error: err?.message };
  }

  // Buy-now check (outside tx so a settlement failure doesn't roll back the bid).
  const fresh = _getAuction(db, auctionId);
  if (fresh?.buyout_cc && amount >= fresh.buyout_cc) {
    const settlement = settleAuction(db, auctionId, { reason: "buyout" });
    return { ok: true, bid: amount, settled: settlement.ok, settlement };
  }

  return { ok: true, bid: amount, endsAt: fresh.ends_at };
}

/** Seller cancels an auction with no bids. */
export function cancelAuction(db, auctionId, userId) {
  const a = _getAuction(db, auctionId);
  if (!a) return { ok: false, error: "no_auction" };
  if (a.seller_user_id !== userId) return { ok: false, error: "not_authorized" };
  if (a.status !== "active") return { ok: false, error: "not_active" };
  if (a.bid_count > 0) return { ok: false, error: "has_bids" };
  try {
    db.prepare(`UPDATE auctions SET status = 'cancelled', settled_at = unixepoch() WHERE id = ?`).run(auctionId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/** Settle: transfer item + pay seller + platform fee + emit. */
export function settleAuction(db, auctionId, opts = {}) {
  const a = _getAuction(db, auctionId);
  if (!a) return { ok: false, error: "no_auction" };
  if (a.status !== "active") return { ok: false, error: "not_active" };

  if (a.bid_count === 0) {
    // No bids → expire.
    try {
      db.prepare(`UPDATE auctions SET status = 'expired', settled_at = unixepoch() WHERE id = ?`).run(auctionId);
    } catch { /* table optional */ }
    return { ok: true, expired: true };
  }

  const winningBid = a.current_bid_cc;
  const platformFee = Math.round(winningBid * PLATFORM_FEE_RATE * 100) / 100;
  const sellerPayout = winningBid - platformFee;

  const tx = db.transaction(() => {
    // Credit seller (the winning bidder's hold was already taken).
    _walletCredit(db, a.seller_user_id, sellerPayout, `auction_payout:${auctionId}`);

    // Transfer item ownership.
    if (a.item_kind === "dtu") {
      try {
        db.prepare(`UPDATE dtus SET creator_id = ? WHERE id = ?`).run(a.leading_bidder_user_id, a.item_id);
      } catch { /* dtus optional on minimal builds */ }
    }
    // inventory transfers handled elsewhere — this just marks the auction settled.

    db.prepare(`UPDATE auctions SET status = 'sold', settled_at = unixepoch() WHERE id = ?`).run(auctionId);

    // D1 — record the sale into the per-item price-history time series.
    try {
      db.prepare(`
        INSERT INTO auction_price_history (item_id, item_kind, world_id, sale_cc, auction_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(a.item_id, a.item_kind || null, a.world_id || null, winningBid, auctionId);
    } catch { /* price-history table optional on a pre-271 build */ }
  });

  try {
    tx();
  } catch (err) {
    return { ok: false, error: err?.message };
  }

  // Realtime emit.
  try {
    globalThis._concordRealtimeEmit?.("auction:settled", {
      auctionId,
      sellerUserId: a.seller_user_id,
      buyerUserId: a.leading_bidder_user_id,
      winningBidCc: winningBid,
      platformFee,
      sellerPayout,
      reason: opts.reason || "expired",
    });
  } catch { /* emit best-effort */ }

  return { ok: true, sold: true, winningBid, sellerPayout, platformFee };
}

export function listActiveAuctions(db, opts = {}) {
  if (!db) return [];
  const limit = Math.min(Math.max(1, opts.limit || 50), 200);
  try {
    return db.prepare(`
      SELECT id, seller_user_id AS sellerUserId, world_id AS worldId,
             item_kind AS itemKind, item_id AS itemId, title,
             start_cc AS startCc, current_bid_cc AS currentBidCc,
             buyout_cc AS buyoutCc, bid_count AS bidCount,
             leading_bidder_user_id AS leadingBidderUserId,
             starts_at AS startsAt, ends_at AS endsAt
      FROM auctions
      WHERE status = 'active' AND ends_at > unixepoch()
      ORDER BY ends_at ASC LIMIT ?
    `).all(limit);
  } catch {
    return [];
  }
}

export function getAuction(db, auctionId) {
  if (!db) return null;
  const a = _getAuction(db, auctionId);
  if (!a) return null;
  let recentBids = [];
  try {
    recentBids = db.prepare(`
      SELECT id, bidder_user_id AS bidderUserId, amount_cc AS amountCc, placed_at AS placedAt
      FROM auction_bids WHERE auction_id = ?
      ORDER BY placed_at DESC LIMIT 20
    `).all(auctionId);
  } catch { /* table optional */ }
  return { ...a, recentBids };
}

/** Settler heartbeat — sweep auctions whose ends_at passed. */
export function sweepEndedAuctions(db) {
  if (!db) return { settled: 0 };
  let settled = 0;
  try {
    const ended = db.prepare(`
      SELECT id FROM auctions
      WHERE status = 'active' AND ends_at <= unixepoch()
      LIMIT 100
    `).all();
    for (const e of ended) {
      const r = settleAuction(db, e.id, { reason: "ended" });
      if (r.ok) settled++;
    }
  } catch (err) {
    logger.debug?.("auctions", "sweep_failed", { error: err?.message });
  }
  return { settled };
}

// ── internal helpers ────────────────────────────────────────────────────

function _getAuction(db, auctionId) {
  try {
    return db.prepare(`SELECT * FROM auctions WHERE id = ?`).get(auctionId) || null;
  } catch {
    return null;
  }
}

function _walletDebit(db, userId, amount, reason) {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: true };
  try {
    const row = db.prepare(`SELECT concordia_credits AS balance FROM users WHERE id = ?`).get(userId);
    const balance = Number(row?.balance) || 0;
    if (balance < amount) return { ok: false, error: "insufficient_funds" };
    db.prepare(`UPDATE users SET concordia_credits = concordia_credits - ? WHERE id = ?`).run(amount, userId);
    try {
      db.prepare(`
        INSERT INTO reward_ledger (id, user_id, kind, amount_cc, ts, ref_id)
        VALUES (?, ?, 'auction_debit', ?, unixepoch(), ?)
      `).run(`led_${crypto.randomBytes(6).toString("hex")}`, userId, -amount, reason);
    } catch { /* ledger optional */ }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

function _walletCredit(db, userId, amount, reason) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  try {
    db.prepare(`
      UPDATE users SET concordia_credits = concordia_credits + ? WHERE id = ?
    `).run(amount, userId);
    try {
      db.prepare(`
        INSERT INTO reward_ledger (id, user_id, kind, amount_cc, ts, ref_id)
        VALUES (?, ?, 'auction_credit', ?, unixepoch(), ?)
      `).run(`led_${crypto.randomBytes(6).toString("hex")}`, userId, amount, reason);
    } catch { /* ledger optional */ }
  } catch { /* wallets table optional */ }
}

// ──────────────────────────────────────────────────────────────────────
// Phase AC — buy orders (EVE-style)
// ──────────────────────────────────────────────────────────────────────
//
// Symmetric inverse of the sell-side path: buyer escrows
// unit_price × quantity_wanted; sellers atomically fill any quantity up
// to remaining. Cancel/expire refunds the unfilled portion. Buy orders
// aren't time-pressured (no snipe rule); they expire after 7 days by
// default. Same royalty cascade as the sell-side fires on each fill
// when the item is a DTU.

const DEFAULT_BUY_ORDER_TTL_S = 7 * 24 * 60 * 60;

export function placeBuyOrder(db, buyerId, opts = {}) {
  if (!db || !buyerId) return { ok: false, error: "missing_inputs" };
  const {
    worldId = "concordia-hub",
    itemKind = "dtu",
    itemDescriptor,
    itemFilter = null,
    unitPriceCc,
    quantity,
    ttlSeconds = DEFAULT_BUY_ORDER_TTL_S,
  } = opts;

  if (!itemDescriptor) return { ok: false, error: "missing_item_descriptor" };
  if (!Number.isFinite(unitPriceCc) || unitPriceCc <= 0) {
    return { ok: false, error: "invalid_unit_price" };
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: "invalid_quantity" };
  }
  if (!["dtu", "inventory"].includes(itemKind)) {
    return { ok: false, error: "invalid_item_kind" };
  }

  const total = Math.round(unitPriceCc * quantity * 100) / 100;
  const debit = _walletDebit(db, buyerId, total, `buy_order_escrow:${itemDescriptor}`);
  if (!debit.ok) return debit;

  const id = `bo_${crypto.randomBytes(8).toString("hex")}`;
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

  try {
    db.prepare(`
      INSERT INTO auction_buy_orders
        (id, buyer_user_id, world_id, item_kind, item_descriptor,
         item_filter_json, unit_price_cc, quantity_wanted,
         total_escrow_cc, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, buyerId, worldId, itemKind, itemDescriptor,
      itemFilter ? JSON.stringify(itemFilter) : null,
      unitPriceCc, quantity, total, expiresAt
    );
    logger.info?.("auctions", "buy_order_placed", { id, buyerId, total, quantity });
    return { ok: true, buyOrderId: id, escrowCc: total, expiresAt };
  } catch (err) {
    // Refund on insert failure.
    _walletCredit(db, buyerId, total, `buy_order_refund_oninsert:${err?.message}`);
    return { ok: false, error: err?.message || "db_error" };
  }
}

export function fillBuyOrder(db, buyOrderId, sellerId, quantity) {
  if (!db || !buyOrderId || !sellerId) return { ok: false, error: "missing_inputs" };
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: "invalid_quantity" };
  }

  try {
    const order = db.prepare(`SELECT * FROM auction_buy_orders WHERE id = ?`).get(buyOrderId);
    if (!order) return { ok: false, error: "no_order" };
    if (order.status === "filled" || order.status === "cancelled" || order.status === "expired") {
      return { ok: false, error: `order_${order.status}` };
    }
    if (order.expires_at < Math.floor(Date.now() / 1000)) {
      return { ok: false, error: "order_expired" };
    }
    if (sellerId === order.buyer_user_id) {
      return { ok: false, error: "self_fill" };
    }

    const remaining = order.quantity_wanted - order.quantity_filled;
    if (remaining <= 0) return { ok: false, error: "already_filled" };

    const fillQty = Math.min(quantity, remaining);
    const payment = Math.round(order.unit_price_cc * fillQty * 100) / 100;

    const newFilled = order.quantity_filled + fillQty;
    const newStatus = newFilled >= order.quantity_wanted ? "filled" : "partial";

    const fillId = `bof_${crypto.randomBytes(8).toString("hex")}`;
    db.prepare(`
      INSERT INTO auction_buy_fills
        (id, buy_order_id, seller_user_id, quantity, unit_price_cc)
      VALUES (?, ?, ?, ?, ?)
    `).run(fillId, buyOrderId, sellerId, fillQty, order.unit_price_cc);

    db.prepare(`
      UPDATE auction_buy_orders
      SET quantity_filled = ?, status = ?
      WHERE id = ?
    `).run(newFilled, newStatus, buyOrderId);

    _walletCredit(db, sellerId, payment, `buy_order_fill:${buyOrderId}`);

    logger.info?.("auctions", "buy_order_filled", {
      buyOrderId, sellerId, fillQty, payment, newStatus,
    });
    return {
      ok: true, fillId, fillQty, payment,
      newStatus, remaining: order.quantity_wanted - newFilled,
    };
  } catch (err) {
    return { ok: false, error: err?.message || "db_error" };
  }
}

export function cancelBuyOrder(db, buyOrderId, buyerId) {
  if (!db || !buyOrderId || !buyerId) return { ok: false, error: "missing_inputs" };
  try {
    const order = db.prepare(`SELECT * FROM auction_buy_orders WHERE id = ?`).get(buyOrderId);
    if (!order) return { ok: false, error: "no_order" };
    if (order.buyer_user_id !== buyerId) return { ok: false, error: "not_owner" };
    if (order.status === "cancelled") return { ok: false, error: "already_cancelled" };
    if (order.status === "filled") return { ok: false, error: "already_filled" };

    const unfilled = order.quantity_wanted - order.quantity_filled;
    const refund = Math.round(order.unit_price_cc * unfilled * 100) / 100;

    db.prepare(`UPDATE auction_buy_orders SET status = 'cancelled' WHERE id = ?`).run(buyOrderId);
    if (refund > 0) {
      _walletCredit(db, buyerId, refund, `buy_order_cancel_refund:${buyOrderId}`);
    }
    return { ok: true, refundCc: refund };
  } catch (err) {
    return { ok: false, error: err?.message || "db_error" };
  }
}

export function listOpenBuyOrders(db, opts = {}) {
  try {
    const { worldId, itemDescriptor, limit = 50 } = opts;
    const filters = ["status IN ('open','partial')", "expires_at > unixepoch()"];
    const args = [];
    if (worldId) { filters.push("world_id = ?"); args.push(worldId); }
    if (itemDescriptor) { filters.push("item_descriptor = ?"); args.push(itemDescriptor); }
    args.push(Math.max(1, Math.min(500, limit)));
    return db.prepare(`
      SELECT id, buyer_user_id, world_id, item_kind, item_descriptor,
             unit_price_cc, quantity_wanted, quantity_filled, total_escrow_cc,
             status, posted_at, expires_at
      FROM auction_buy_orders
      WHERE ${filters.join(" AND ")}
      ORDER BY unit_price_cc DESC, posted_at ASC
      LIMIT ?
    `).all(...args);
  } catch {
    return [];
  }
}

/**
 * Sweep expired-but-not-yet-marked buy orders, refund their unfilled
 * portion. Heartbeat-friendly; idempotent.
 */
export function sweepExpiredBuyOrders(db) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const expired = db.prepare(`
      SELECT id, buyer_user_id, unit_price_cc, quantity_wanted, quantity_filled
      FROM auction_buy_orders
      WHERE status IN ('open','partial') AND expires_at <= ?
      LIMIT 100
    `).all(now);

    let refunded = 0;
    const markExpired = db.prepare(`UPDATE auction_buy_orders SET status = 'expired' WHERE id = ?`);
    for (const o of expired) {
      const unfilled = o.quantity_wanted - o.quantity_filled;
      const refund = Math.round(o.unit_price_cc * unfilled * 100) / 100;
      markExpired.run(o.id);
      if (refund > 0) {
        _walletCredit(db, o.buyer_user_id, refund, `buy_order_expired_refund:${o.id}`);
        refunded += refund;
      }
    }
    return { ok: true, expired: expired.length, refunded };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

// ── D1 / F7.1 — marketplace depth ────────────────────────────────────────────

/** Per-item sale price-history time series (oldest → newest, capped). */
export function getPriceHistory(db, itemId, opts = {}) {
  if (!db || !itemId) return { points: [], stats: null };
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 100));
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT sale_cc, sold_at FROM auction_price_history
      WHERE item_id = ? ORDER BY sold_at DESC LIMIT ?
    `).all(itemId, limit).reverse();
  } catch { return { points: [], stats: null }; }
  if (rows.length === 0) return { points: [], stats: null };
  const prices = rows.map((r) => r.sale_cc);
  const min = Math.min(...prices), max = Math.max(...prices);
  const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
  const first = prices[0], last = prices[prices.length - 1];
  return {
    points: rows.map((r) => ({ cc: r.sale_cc, at: r.sold_at })),
    stats: {
      count: prices.length,
      min, max, avg: Math.round(avg * 100) / 100, last,
      // appreciation curve: % change first→last sale
      changePct: first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : 0,
    },
  };
}

/**
 * Order-book depth for an item: ask side from active auctions (asc by price),
 * bid side from open buy-orders (desc by price), each aggregated to a level
 * with total quantity — the buy/sell spread display.
 */
export function getMarketDepth(db, itemId) {
  if (!db || !itemId) return { asks: [], bids: [], spread: null };
  let askRows = [], bidRows = [];
  try {
    askRows = db.prepare(`
      SELECT COALESCE(NULLIF(current_bid_cc, 0), start_cc) AS price, COUNT(*) AS qty
      FROM auctions WHERE item_id = ? AND status = 'active'
      GROUP BY price ORDER BY price ASC LIMIT 20
    `).all(itemId);
  } catch { /* auctions optional */ }
  try {
    bidRows = db.prepare(`
      SELECT unit_price_cc AS price, SUM(quantity_wanted - quantity_filled) AS qty
      FROM auction_buy_orders
      WHERE item_descriptor = ? AND status IN ('open','partial')
      GROUP BY unit_price_cc HAVING qty > 0 ORDER BY price DESC LIMIT 20
    `).all(itemId);
  } catch { /* buy-orders optional */ }
  const bestAsk = askRows.length ? askRows[0].price : null;
  const bestBid = bidRows.length ? bidRows[0].price : null;
  const spread = bestAsk != null && bestBid != null ? Math.round((bestAsk - bestBid) * 100) / 100 : null;
  return {
    asks: askRows.map((r) => ({ price: r.price, qty: r.qty })),
    bids: bidRows.map((r) => ({ price: r.price, qty: r.qty })),
    bestAsk, bestBid, spread,
  };
}
