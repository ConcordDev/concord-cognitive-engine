// server/routes/player-trade.js
// Player-to-player trade with both-sides-confirm escrow.
//
// Mirrors the wagers.js two-party pattern but trades item bundles + coins
// instead of just coin amounts. Mounted at /api/player-trade.
//
// Flow:
//   1. POST /initiate     — initiator names recipient, session created
//   2. POST /:id/offer    — either party sets their offer (items + coins)
//   3. POST /:id/ready    — either party flips to ready; if both ready, execute
//   4. POST /:id/cancel   — either party can abort at any point
//
// Re-verification at execution time prevents the offered items from being
// duplicated by the seller in another session before the trade settles.

import { Router } from "express";
import crypto from "crypto";
import { logInventoryTransfer } from "../lib/inventory-audit.js";
import { withEntityLock } from "../lib/entity-lock.js";

const ACCEPT_WINDOW_S = 5 * 60; // 5 minute trade lifetime
const MAX_ACTIVE_TRADES_PER_USER = 3;
const BALANCE_COLS = { sparks: "sparks", cc: "concordia_credits" };

export default function createPlayerTradeRouter({ requireAuth, db, emitToUser }) {
  const router = Router();
  const auth = requireAuth;
  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;
  const _emit = (uid, event, payload) => {
    try { emitToUser?.(uid, event, payload); }
    catch { /* realtime is best-effort */ }
  };

  // GET /api/player-trade — list my active trades
  router.get("/", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const trades = db.prepare(`
        SELECT * FROM player_trades
        WHERE (initiator_id = ? OR recipient_id = ?)
          AND status IN ('pending', 'both_offered', 'initiator_ready', 'recipient_ready')
        ORDER BY created_at DESC
      `).all(userId, userId);
      res.json({ ok: true, trades });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // GET /api/player-trade/:id — single trade detail
  router.get("/:id", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const trade = db.prepare(`SELECT * FROM player_trades WHERE id = ?`).get(req.params.id);
      if (!trade) return res.status(404).json({ ok: false, error: "trade_not_found" });
      if (trade.initiator_id !== userId && trade.recipient_id !== userId) {
        return res.status(403).json({ ok: false, error: "not_a_participant" });
      }
      res.json({ ok: true, trade });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/player-trade/initiate
  router.post("/initiate", auth, (req, res) => {
    try {
      const initiatorId = _userId(req);
      const { recipientId } = req.body;
      if (!recipientId) return res.status(400).json({ ok: false, error: "recipientId required" });
      if (recipientId === initiatorId) {
        return res.status(400).json({ ok: false, error: "cannot_trade_with_self" });
      }

      const recipient = db.prepare(`SELECT id FROM users WHERE id = ?`).get(recipientId);
      if (!recipient) return res.status(404).json({ ok: false, error: "recipient_not_found" });

      // Anti-spam: max active trades per user
      const activeCount = db.prepare(`
        SELECT COUNT(*) AS n FROM player_trades
        WHERE initiator_id = ?
          AND status IN ('pending', 'both_offered', 'initiator_ready', 'recipient_ready')
      `).get(initiatorId)?.n ?? 0;
      if (activeCount >= MAX_ACTIVE_TRADES_PER_USER) {
        return res.status(429).json({ ok: false, error: "too_many_active_trades" });
      }

      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        INSERT INTO player_trades (id, initiator_id, recipient_id, status, created_at, expires_at)
        VALUES (?, ?, ?, 'pending', ?, ?)
      `).run(id, initiatorId, recipientId, now, now + ACCEPT_WINDOW_S);

      _emit(recipientId, "trade:request", {
        tradeId: id,
        initiatorId,
        expiresAt: (now + ACCEPT_WINDOW_S) * 1000,
      });

      res.status(201).json({ ok: true, tradeId: id, expiresAt: (now + ACCEPT_WINDOW_S) * 1000 });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/player-trade/:id/offer
  // Body: { items: [{ inventoryId, quantity }], sparks: number, cc: number }
  router.post("/:id/offer", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const trade = db.prepare(`SELECT * FROM player_trades WHERE id = ?`).get(req.params.id);
      if (!trade) return res.status(404).json({ ok: false, error: "trade_not_found" });
      if (_isFinalStatus(trade.status)) {
        return res.status(400).json({ ok: false, error: "trade_already_finished" });
      }
      const isInitiator = trade.initiator_id === userId;
      const isRecipient = trade.recipient_id === userId;
      if (!isInitiator && !isRecipient) {
        return res.status(403).json({ ok: false, error: "not_a_participant" });
      }

      const offer = _normalizeOffer(req.body);
      const verdict = _verifyOfferOwnership(db, userId, offer);
      if (!verdict.ok) return res.status(400).json({ ok: false, error: verdict.error });

      const offerCol = isInitiator ? "initiator_offer_json" : "recipient_offer_json";
      const otherOfferCol = isInitiator ? "recipient_offer_json" : "initiator_offer_json";
      const otherOffer = _tryParseJson(trade[otherOfferCol]) ?? { items: [], sparks: 0, cc: 0 };
      const bothOffered =
        (offer.items.length > 0 || offer.sparks > 0 || offer.cc > 0) &&
        (otherOffer.items.length > 0 || otherOffer.sparks > 0 || otherOffer.cc > 0);

      // Changing the offer un-readies BOTH sides (industry standard — see RPGMaker
      // MMORPG plugin and Steam trade) so players can't slip a swap past a Ready.
      db.prepare(`
        UPDATE player_trades
        SET ${offerCol} = ?,
            status = ?,
            initiator_ready_at = NULL,
            recipient_ready_at = NULL
        WHERE id = ?
      `).run(JSON.stringify(offer), bothOffered ? "both_offered" : "pending", trade.id);

      const otherUserId = isInitiator ? trade.recipient_id : trade.initiator_id;
      _emit(otherUserId, "trade:offer_updated", {
        tradeId: trade.id,
        bySide: isInitiator ? "initiator" : "recipient",
        offer,
      });

      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/player-trade/:id/ready
  router.post("/:id/ready", auth, async (req, res) => {
    try {
      const userId = _userId(req);
      // Adversarial-hardening: serialize all read-modify-write on THIS trade so
      // two concurrent /ready requests can't both observe "both ready" and call
      // _executeTrade twice (the items/coins are escrowed once — a double
      // execute would attempt to transfer them twice). Keyed by trade id, so
      // different trades stay fully parallel.
      const outcome = await withEntityLock(`trade:${req.params.id}`, () => {
        const trade = db.prepare(`SELECT * FROM player_trades WHERE id = ?`).get(req.params.id);
        if (!trade) return { status: 404, body: { ok: false, error: "trade_not_found" } };
        if (_isFinalStatus(trade.status)) {
          return { status: 400, body: { ok: false, error: "trade_already_finished" } };
        }
        const isInitiator = trade.initiator_id === userId;
        const isRecipient = trade.recipient_id === userId;
        if (!isInitiator && !isRecipient) {
          return { status: 403, body: { ok: false, error: "not_a_participant" } };
        }

        const now = Math.floor(Date.now() / 1000);
        if (now > trade.expires_at) {
          db.prepare(`UPDATE player_trades SET status = 'expired' WHERE id = ?`).run(trade.id);
          return { status: 400, body: { ok: false, error: "trade_expired" } };
        }

        const readyCol = isInitiator ? "initiator_ready_at" : "recipient_ready_at";
        db.prepare(`UPDATE player_trades SET ${readyCol} = ? WHERE id = ?`).run(now, trade.id);

        // Tell the other party. This is *not* the success message — the other
        // side still needs to hit Ready themselves.
        const otherUserId = isInitiator ? trade.recipient_id : trade.initiator_id;
        _emit(otherUserId, "trade:other_ready", {
          tradeId: trade.id,
          bySide: isInitiator ? "initiator" : "recipient",
        });

        // If both sides are now ready, execute atomically.
        const updated = db.prepare(`SELECT * FROM player_trades WHERE id = ?`).get(trade.id);
        if (!updated) return { status: 409, body: { ok: false, error: "trade_no_longer_exists" } };
        if (updated.initiator_ready_at && updated.recipient_ready_at) {
          const result = _executeTrade(db, updated);
          if (!result.ok) return { status: 400, body: { ok: false, error: result.error } };
          _emit(updated.initiator_id, "trade:complete", {
            tradeId: updated.id,
            received: _tryParseJson(updated.recipient_offer_json),
          });
          _emit(updated.recipient_id, "trade:complete", {
            tradeId: updated.id,
            received: _tryParseJson(updated.initiator_offer_json),
          });
          return { status: 200, body: { ok: true, complete: true } };
        }

        return { status: 200, body: { ok: true, complete: false, awaitingOther: true } };
      });

      res.status(outcome.status).json(outcome.body);
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/player-trade/:id/cancel
  router.post("/:id/cancel", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const trade = db.prepare(`SELECT * FROM player_trades WHERE id = ?`).get(req.params.id);
      if (!trade) return res.status(404).json({ ok: false, error: "trade_not_found" });
      if (_isFinalStatus(trade.status)) {
        return res.status(400).json({ ok: false, error: "trade_already_finished" });
      }
      if (trade.initiator_id !== userId && trade.recipient_id !== userId) {
        return res.status(403).json({ ok: false, error: "not_a_participant" });
      }

      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        UPDATE player_trades
        SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?
        WHERE id = ?
      `).run(now, userId, req.body?.reason || "user_cancelled", trade.id);

      _emit(trade.initiator_id, "trade:cancelled", { tradeId: trade.id, by: userId });
      _emit(trade.recipient_id, "trade:cancelled", { tradeId: trade.id, by: userId });

      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  return router;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function _isFinalStatus(s) {
  return s === "complete" || s === "cancelled" || s === "expired";
}

function _tryParseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function _normalizeOffer(body) {
  const items = Array.isArray(body?.items) ? body.items : [];
  return {
    items: items
      .filter((i) => i && typeof i.inventoryId === "string" && Number(i.quantity) > 0)
      .map((i) => ({ inventoryId: String(i.inventoryId), quantity: Math.floor(Number(i.quantity)) })),
    sparks: Math.max(0, Math.floor(Number(body?.sparks) || 0)),
    cc:     Math.max(0, Math.floor(Number(body?.cc) || 0)),
  };
}

function _verifyOfferOwnership(db, userId, offer) {
  for (const it of offer.items) {
    const row = db.prepare(`
      SELECT user_id, quantity, soulbound, item_name FROM player_inventory WHERE id = ?
    `).get(it.inventoryId);
    if (!row) return { ok: false, error: `unknown_item:${it.inventoryId}` };
    if (row.user_id !== userId) return { ok: false, error: `not_your_item:${it.inventoryId}` };
    if (row.quantity < it.quantity) return { ok: false, error: `insufficient_quantity:${it.inventoryId}` };
    if (row.soulbound) return { ok: false, error: `soulbound:${row.item_name || it.inventoryId}` };
  }
  if (offer.sparks > 0) {
    const u = db.prepare(`SELECT sparks FROM users WHERE id = ?`).get(userId);
    if (!u || (u.sparks ?? 0) < offer.sparks) return { ok: false, error: "insufficient_sparks" };
  }
  if (offer.cc > 0) {
    const u = db.prepare(`SELECT concordia_credits FROM users WHERE id = ?`).get(userId);
    if (!u || (u.concordia_credits ?? 0) < offer.cc) return { ok: false, error: "insufficient_cc" };
  }
  return { ok: true };
}

function _executeTrade(db, trade) {
  const initiatorOffer = _tryParseJson(trade.initiator_offer_json) ?? { items: [], sparks: 0, cc: 0 };
  const recipientOffer = _tryParseJson(trade.recipient_offer_json) ?? { items: [], sparks: 0, cc: 0 };

  const tx = db.transaction(() => {
    // Re-verify at execution time. Prevents race where one party spent an item
    // between Ready and execute.
    const v1 = _verifyOfferOwnership(db, trade.initiator_id, initiatorOffer);
    if (!v1.ok) throw new Error(`initiator_verify_failed:${v1.error}`);
    const v2 = _verifyOfferOwnership(db, trade.recipient_id, recipientOffer);
    if (!v2.ok) throw new Error(`recipient_verify_failed:${v2.error}`);

    _transferItems(db, trade.initiator_id, trade.recipient_id, initiatorOffer.items, trade.id);
    _transferItems(db, trade.recipient_id, trade.initiator_id, recipientOffer.items, trade.id);

    if (initiatorOffer.sparks > 0) _transferCoins(db, "sparks", trade.initiator_id, trade.recipient_id, initiatorOffer.sparks);
    if (recipientOffer.sparks > 0) _transferCoins(db, "sparks", trade.recipient_id, trade.initiator_id, recipientOffer.sparks);
    if (initiatorOffer.cc > 0) _transferCoins(db, "concordia_credits", trade.initiator_id, trade.recipient_id, initiatorOffer.cc);
    if (recipientOffer.cc > 0) _transferCoins(db, "concordia_credits", trade.recipient_id, trade.initiator_id, recipientOffer.cc);

    const now = Math.floor(Date.now() / 1000);
    db.prepare(`UPDATE player_trades SET status = 'complete', completed_at = ? WHERE id = ?`).run(now, trade.id);
  });

  try {
    tx();
    return { ok: true };
  } catch (e) {
    const reason = String(e?.message || e);
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      UPDATE player_trades
      SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'system', cancel_reason = ?
      WHERE id = ?
    `).run(now, reason, trade.id);
    return { ok: false, error: reason };
  }
}

function _transferItems(db, fromUserId, toUserId, items, refTradeId) {
  // @sql-loop-ok: iterates trade items (bounded by trade-size cap, typically 1-5)
  for (const it of items) {
    const src = db.prepare(`SELECT * FROM player_inventory WHERE id = ?`).get(it.inventoryId);
    if (!src || src.user_id !== fromUserId || src.quantity < it.quantity) {
      throw new Error(`item_transfer_failed:${it.inventoryId}`);
    }

    if (src.quantity === it.quantity) {
      // Move the row entire — preserves quality + acquired_at lineage
      db.prepare(`
        UPDATE player_inventory
        SET user_id = ?, reserved_until = NULL, reserved_by = NULL
        WHERE id = ?
      `).run(toUserId, src.id);
    } else {
      // Partial: decrement source, create a new row for the destination
      db.prepare(`UPDATE player_inventory SET quantity = quantity - ? WHERE id = ?`).run(it.quantity, src.id);
      const newId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, quality, soulbound, acquired_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      `).run(newId, toUserId, src.item_type, src.item_id, src.item_name, it.quantity, src.quality, src.soulbound ?? 0);
    }

    // Phase 10: append-only audit log entry for every item movement.
    try {
      logInventoryTransfer(db, {
        actorUserId: fromUserId,
        fromUserId,
        toUserId,
        itemId: src.item_id,
        itemName: src.item_name,
        delta: it.quantity,
        category: "trade",
        refId: refTradeId,
        beforeQty: src.quantity,
        afterQty: src.quantity - it.quantity,
      });
    } catch { /* audit failure must never block a successful transfer */ }
  }
}

function _transferCoins(db, column, fromUserId, toUserId, amount) {
  if (column !== "sparks" && column !== "concordia_credits") {
    throw new Error("invalid_currency_column");
  }
  const from = db.prepare(`SELECT ${column} AS bal FROM users WHERE id = ?`).get(fromUserId);
  if (!from || (from.bal ?? 0) < amount) throw new Error("insufficient_balance");
  db.prepare(`UPDATE users SET ${column} = ${column} - ? WHERE id = ?`).run(amount, fromUserId);
  db.prepare(`UPDATE users SET ${column} = ${column} + ? WHERE id = ?`).run(amount, toUserId);
}

