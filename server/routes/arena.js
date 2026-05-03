// server/routes/arena.js
// Structured PvP arena: skill-based matchmaking queue + match resolution + Elo ratings.
// Queue is DB-backed (survives restarts). Matching uses Elo ±200 window, widening over time.

import { Router } from "express";
import crypto from "crypto";
import { awardSparks, spendSparks } from "../lib/currency.js";

const ARENA_SPARKS_WAGER    = 25;
const ARENA_PLATFORM_FEE_PCT = 0.02;
const ELO_K                 = 32;  // standard K-factor
const ELO_INITIAL_WINDOW    = 200; // ±200 Elo at join
const ELO_WIDEN_AFTER_MS    = 30_000; // widen to ±400 after 30s
const ELO_ANY_AFTER_MS      = 60_000; // accept any after 60s

// ── Elo helpers ──────────────────────────────────────────────────

function getOrCreateRating(db, userId) {
  const row = db.prepare("SELECT * FROM player_ratings WHERE user_id = ?").get(userId);
  if (!row) {
    db.prepare(
      "INSERT OR IGNORE INTO player_ratings (user_id) VALUES (?)"
    ).run(userId);
    return { user_id: userId, rating: 1200, wins: 0, losses: 0, win_streak: 0 };
  }
  return row;
}

function resolveRatings(db, winnerId, loserId) {
  const winnerRow = getOrCreateRating(db, winnerId);
  const loserRow  = getOrCreateRating(db, loserId);

  const Ra = winnerRow.rating;
  const Rb = loserRow.rating;

  const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));
  const Eb = 1 - Ea;

  const newRa = Math.round(Ra + ELO_K * (1 - Ea));
  const newRb = Math.round(Rb + ELO_K * (0 - Eb));

  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO player_ratings (user_id, rating, wins, win_streak, updated_at)
    VALUES (?, ?, 1, 1, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      rating = excluded.rating,
      wins = wins + 1,
      win_streak = win_streak + 1,
      updated_at = excluded.updated_at
  `).run(winnerId, newRa, now);

  db.prepare(`
    INSERT INTO player_ratings (user_id, rating, losses, win_streak, updated_at)
    VALUES (?, ?, 1, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      rating = excluded.rating,
      losses = losses + 1,
      win_streak = 0,
      updated_at = excluded.updated_at
  `).run(loserId, Math.max(100, newRb), now);

  return { winnerRating: newRa, loserRating: Math.max(100, newRb) };
}

// ── Match creation helper ────────────────────────────────────────

function createMatch(db, userId, opponentId, realtimeEmit) {
  const wagerId = crypto.randomUUID();
  const now     = Date.now();

  spendSparks(db, userId,     ARENA_SPARKS_WAGER, "arena_escrow");
  spendSparks(db, opponentId, ARENA_SPARKS_WAGER, "arena_escrow");

  db.prepare(`
    INSERT INTO wagers
      (id, proposer_id, opponent_id, amount, currency, duel_type, status,
       escrow_locked, world_id, proposed_at, accepted_at, expires_at)
    VALUES (?, ?, ?, ?, 'sparks', 'arena', 'active', 1, 'concordia-hub', ?, ?, ?)
  `).run(wagerId, opponentId, userId, ARENA_SPARKS_WAGER * 2, now, now, now + 30 * 60 * 1000);

  realtimeEmit?.("arena:match:found", { userId: opponentId, matchId: wagerId, opponentId: userId });
  realtimeEmit?.("arena:match:found", { userId,             matchId: wagerId, opponentId });

  return wagerId;
}

// ── Router ───────────────────────────────────────────────────────

export default function createArenaRouter({ requireAuth, db, realtimeEmit }) {
  const router = Router();

  // GET /api/arena/queue — queue status
  router.get("/queue", requireAuth, (req, res) => {
    const userId = req.user.id;
    const entry  = db.prepare("SELECT * FROM arena_queue WHERE user_id = ?").get(userId);
    const size   = db.prepare("SELECT COUNT(*) AS n FROM arena_queue").get().n;
    res.json({ ok: true, queueSize: size, inQueue: !!entry });
  });

  // POST /api/arena/queue — join queue, attempt Elo match
  router.post("/queue", requireAuth, async (req, res) => {
    const userId  = req.user.id;
    const already = db.prepare("SELECT 1 FROM arena_queue WHERE user_id = ?").get(userId);
    if (already) return res.json({ ok: true, status: "already_queued" });

    const myRating = getOrCreateRating(db, userId).rating;

    // Find best Elo match in current queue
    const candidates = db.prepare(
      "SELECT * FROM arena_queue WHERE user_id != ? ORDER BY ABS(rating - ?) ASC"
    ).all(userId, myRating);

    const nowMs = Date.now();
    let matched = null;
    for (const c of candidates) {
      const waitMs   = nowMs - c.queued_at * 1000;
      const window   = waitMs >= ELO_ANY_AFTER_MS ? Infinity
                     : waitMs >= ELO_WIDEN_AFTER_MS ? ELO_INITIAL_WINDOW * 2
                     : ELO_INITIAL_WINDOW;
      if (Math.abs(c.rating - myRating) <= window) {
        matched = c;
        break;
      }
    }

    if (matched) {
      db.prepare("DELETE FROM arena_queue WHERE user_id = ?").run(matched.user_id);

      let wagerId;
      try {
        wagerId = createMatch(db, userId, matched.user_id, realtimeEmit);
      } catch {
        try { awardSparks(db, userId,         ARENA_SPARKS_WAGER, "arena_escrow_refund"); } catch { /* refund best-effort */ }
        try { awardSparks(db, matched.user_id, ARENA_SPARKS_WAGER, "arena_escrow_refund"); } catch { /* refund best-effort */ }
        return res.status(402).json({ ok: false, error: "insufficient_sparks" });
      }

      return res.json({ ok: true, status: "matched", matchId: wagerId, opponentId: matched.user_id });
    }

    // No match — join persistent queue
    const nowSec = Math.floor(nowMs / 1000);
    db.prepare(
      "INSERT OR REPLACE INTO arena_queue (user_id, rating, queued_at, socket_id) VALUES (?, ?, ?, ?)"
    ).run(userId, myRating, nowSec, req.body.socketId ?? null);

    const size = db.prepare("SELECT COUNT(*) AS n FROM arena_queue").get().n;
    res.json({ ok: true, status: "queued", position: size });
  });

  // POST /api/arena/queue/leave — leave queue
  router.post("/queue/leave", requireAuth, (req, res) => {
    db.prepare("DELETE FROM arena_queue WHERE user_id = ?").run(req.user.id);
    res.json({ ok: true });
  });

  // GET /api/arena/matches — player match history
  router.get("/matches", requireAuth, (req, res) => {
    const userId = req.user.id;
    const matches = db.prepare(`
      SELECT w.*, u1.username AS proposer_name, u2.username AS opponent_name
      FROM wagers w
      LEFT JOIN users u1 ON u1.id = w.proposer_id
      LEFT JOIN users u2 ON u2.id = w.opponent_id
      WHERE (w.proposer_id = ? OR w.opponent_id = ?)
        AND w.duel_type = 'arena'
      ORDER BY w.proposed_at DESC
      LIMIT 20
    `).all(userId, userId);
    res.json({ ok: true, matches });
  });

  // POST /api/arena/matches/:id/resolve — resolve match + update Elo
  router.post("/matches/:id/resolve", requireAuth, (req, res) => {
    const { winnerId } = req.body;
    if (!winnerId) return res.status(400).json({ ok: false, error: "winnerId_required" });

    const wager = db.prepare(
      "SELECT * FROM wagers WHERE id = ? AND duel_type = 'arena' AND status = 'active'"
    ).get(req.params.id);
    if (!wager) return res.status(404).json({ ok: false, error: "match_not_found" });

    const loserId = wager.proposer_id === winnerId ? wager.opponent_id : wager.proposer_id;
    const pot     = wager.amount;
    const fee     = Math.floor(pot * ARENA_PLATFORM_FEE_PCT);
    const payout  = pot - fee;

    awardSparks(db, winnerId, payout, "arena_win", "concordia-hub");
    db.prepare("UPDATE wagers SET status = 'resolved', winner_id = ?, resolved_at = ? WHERE id = ?")
      .run(winnerId, Date.now(), wager.id);

    const ratings = resolveRatings(db, winnerId, loserId);

    realtimeEmit?.("world:notification", {
      userId: winnerId,
      message: `Arena victory! +${payout} Sparks  |  Rating: ${ratings.winnerRating}`,
      type: "milestone",
    });
    realtimeEmit?.("world:notification", {
      userId: loserId,
      message: `Arena defeat.  Rating: ${ratings.loserRating}`,
      type: "info",
    });

    res.json({ ok: true, winnerId, payout, fee, ratings });
  });

  // GET /api/arena/rating/:userId — fetch a player's Elo rating
  router.get("/rating/:userId", requireAuth, (req, res) => {
    const row = getOrCreateRating(db, req.params.userId);
    res.json({ ok: true, rating: row.rating, wins: row.wins, losses: row.losses, winStreak: row.win_streak });
  });

  return router;
}
