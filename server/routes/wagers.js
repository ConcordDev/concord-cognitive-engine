// server/routes/wagers.js
// Consensual wager system. CC wagers require explicit two-party consent before money moves.
// Mounted at /api/wagers.

import { Router } from "express";
import crypto from "crypto";

const ACCEPT_WINDOW_S = 60; // opponent has 60 seconds to accept
const MAX_ACTIVE_PROPOSALS = 3;
const BALANCE_COLS = { sparks: "sparks", cc: "concordia_credits" };

export default function createWagersRouter({ requireAuth, db, realtimeEmit }) {
  const router = Router();
  const auth = requireAuth;
  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;

  // GET /api/wagers — list my active/pending wagers
  router.get("/", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const wagers = db.prepare(`
        SELECT * FROM wagers
        WHERE (proposer_id = ? OR opponent_id = ?) AND status IN ('pending', 'active')
        ORDER BY proposed_at DESC
      `).all(userId, userId);
      res.json({ ok: true, wagers });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // POST /api/wagers/propose
  router.post("/propose", auth, (req, res) => {
    try {
      const proposerId = _userId(req);
      const { opponentId, amount, currency, duelType = "combat", worldId = null } = req.body;

      if (!opponentId || !amount || !currency) {
        return res.status(400).json({ ok: false, error: "opponentId, amount, currency required" });
      }
      if (!["sparks", "cc"].includes(currency)) {
        return res.status(400).json({ ok: false, error: "currency must be sparks or cc" });
      }
      if (amount <= 0) return res.status(400).json({ ok: false, error: "amount must be positive" });

      // Anti-spam: max 3 active proposals
      const activeCount = db.prepare(`
        SELECT COUNT(*) AS n FROM wagers WHERE proposer_id = ? AND status = 'pending'
      `).get(proposerId)?.n ?? 0;
      if (activeCount >= MAX_ACTIVE_PROPOSALS) {
        return res.status(429).json({ ok: false, error: "too_many_active_proposals" });
      }

      // Check proposer balance
      const balanceCol = BALANCE_COLS[currency] ?? "sparks";
      const proposer = db.prepare(`SELECT ${balanceCol} AS bal FROM users WHERE id = ?`).get(proposerId);
      if (!proposer || proposer.bal < amount) {
        return res.status(400).json({ ok: false, error: "insufficient_balance" });
      }

      // Escrow amount from proposer
      db.prepare(`UPDATE users SET ${balanceCol} = ${balanceCol} - ? WHERE id = ?`).run(amount, proposerId);

      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        INSERT INTO wagers (id, proposer_id, opponent_id, amount, currency, duel_type, status, escrow_locked, world_id, proposed_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?)
      `).run(id, proposerId, opponentId, amount, currency, duelType, worldId, now, now + ACCEPT_WINDOW_S);

      // Notify opponent via socket
      realtimeEmit?.("wager:proposed", {
        wagerId: id, proposerId, amount, currency, duelType,
        expiresAt: (now + ACCEPT_WINDOW_S) * 1000,
      }, opponentId);

      res.status(201).json({ ok: true, wagerId: id });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // POST /api/wagers/:id/accept
  router.post("/:id/accept", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const wager = db.prepare(`SELECT * FROM wagers WHERE id = ?`).get(req.params.id);
      if (!wager) return res.status(404).json({ ok: false, error: "wager_not_found" });
      if (wager.opponent_id !== userId) return res.status(403).json({ ok: false, error: "not_your_wager" });
      if (wager.status !== "pending") return res.status(400).json({ ok: false, error: "wager_not_pending" });

      const now = Math.floor(Date.now() / 1000);
      if (now > wager.expires_at) {
        // Auto-cancel and refund proposer
        _cancelAndRefund(db, wager);
        return res.status(400).json({ ok: false, error: "wager_expired" });
      }

      // Check opponent balance and escrow
      const balanceCol = BALANCE_COLS[wager.currency] ?? "sparks";
      const opponent = db.prepare(`SELECT ${balanceCol} AS bal FROM users WHERE id = ?`).get(userId);
      if (!opponent || opponent.bal < wager.amount) {
        return res.status(400).json({ ok: false, error: "insufficient_balance" });
      }

      db.prepare(`UPDATE users SET ${balanceCol} = ${balanceCol} - ? WHERE id = ?`).run(wager.amount, userId);
      db.prepare(`UPDATE wagers SET status = 'active', accepted_at = ? WHERE id = ?`).run(now, wager.id);

      realtimeEmit?.("wager:accepted", { wagerId: wager.id }, wager.proposer_id);
      res.json({ ok: true, wagerId: wager.id });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // POST /api/wagers/:id/decline
  router.post("/:id/decline", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const wager = db.prepare(`SELECT * FROM wagers WHERE id = ?`).get(req.params.id);
      if (!wager) return res.status(404).json({ ok: false, error: "not_found" });
      if (wager.opponent_id !== userId) return res.status(403).json({ ok: false, error: "not_your_wager" });
      if (wager.status !== "pending") return res.status(400).json({ ok: false, error: "wager_not_pending" });

      _cancelAndRefund(db, wager);
      realtimeEmit?.("wager:declined", { wagerId: wager.id }, wager.proposer_id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // POST /api/wagers/:id/resolve — server verifies outcome (called by game server, not directly by players)
  router.post("/:id/resolve", auth, (req, res) => {
    try {
      const { winnerId } = req.body;
      const wager = db.prepare(`SELECT * FROM wagers WHERE id = ?`).get(req.params.id);
      if (!wager) return res.status(404).json({ ok: false, error: "not_found" });
      if (wager.status !== "active") return res.status(400).json({ ok: false, error: "wager_not_active" });
      if (winnerId !== wager.proposer_id && winnerId !== wager.opponent_id) {
        return res.status(400).json({ ok: false, error: "winner_not_a_participant" });
      }

      const pot = wager.amount * 2;
      const fee = Math.ceil(pot * 0.02); // 2% platform fee
      const payout = pot - fee;

      const balanceCol = BALANCE_COLS[wager.currency] ?? "sparks";
      db.prepare(`UPDATE users SET ${balanceCol} = ${balanceCol} + ? WHERE id = ?`).run(payout, winnerId);

      const now = Math.floor(Date.now() / 1000);
      db.prepare(`UPDATE wagers SET status = 'resolved', winner_id = ?, resolved_at = ? WHERE id = ?`)
        .run(winnerId, now, wager.id);

      realtimeEmit?.("wager:resolved", { wagerId: wager.id, winnerId, payout, currency: wager.currency });
      res.json({ ok: true, winnerId, payout, currency: wager.currency });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  return router;
}

function _cancelAndRefund(db, wager) {
  const balanceCol = BALANCE_COLS[wager.currency] ?? "sparks";
  db.prepare(`UPDATE users SET ${balanceCol} = ${balanceCol} + ? WHERE id = ?`).run(wager.amount, wager.proposer_id);
  db.prepare(`UPDATE wagers SET status = 'cancelled' WHERE id = ?`).run(wager.id);
}
