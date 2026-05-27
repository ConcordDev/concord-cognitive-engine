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
        db.prepare(`UPDATE dtus SET created_by = ? WHERE id = ?`).run(a.leading_bidder_user_id, a.item_id);
      } catch { /* dtus optional on minimal builds */ }
    }
    // inventory transfers handled elsewhere — this just marks the auction settled.

    db.prepare(`UPDATE auctions SET status = 'sold', settled_at = unixepoch() WHERE id = ?`).run(auctionId);
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
    const row = db.prepare(`SELECT balance FROM user_wallets WHERE user_id = ?`).get(userId);
    const balance = Number(row?.balance) || 0;
    if (balance < amount) return { ok: false, error: "insufficient_funds" };
    db.prepare(`UPDATE user_wallets SET balance = balance - ? WHERE user_id = ?`).run(amount, userId);
    try {
      db.prepare(`
        INSERT INTO economy_ledger (id, user_id, kind, amount_cc, ts, ref_id)
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
      INSERT INTO user_wallets (user_id, balance) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET balance = balance + excluded.balance
    `).run(userId, amount);
    try {
      db.prepare(`
        INSERT INTO economy_ledger (id, user_id, kind, amount_cc, ts, ref_id)
        VALUES (?, ?, 'auction_credit', ?, unixepoch(), ?)
      `).run(`led_${crypto.randomBytes(6).toString("hex")}`, userId, amount, reason);
    } catch { /* ledger optional */ }
  } catch { /* wallets table optional */ }
}
