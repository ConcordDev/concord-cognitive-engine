// server/routes/training-match.js
//
// PvP Training Match endpoints. Mounted at /api/training-match.
//
// Flow:
//   1. POST /challenge        — initiator picks an opponent. Pending row.
//   2. POST /:id/accept       — opponent accepts. Status → active.
//                               Realtime emit: training:start to both.
//   3. POST /:id/safe-reset   — either player can request a reset; full HP +
//                               stamina + 3s safe-zone bubble for both.
//                               Realtime emit: training:reset to both.
//   4. POST /:id/round-end    — server-internal hook from the combat:kill
//                               handler when a kill lands inside a training
//                               context. Records the winner of the round
//                               and increments rounds_played; auto-resets
//                               unless rounds_played == max_rounds.
//   5. POST /:id/forfeit      — either side ends the match.
//   6. GET  /me               — caller's active match (one max).
//   7. GET  /:id              — full match detail incl. rounds.
//
// Both players' attacks already record into combat_flows via the regular
// combat:attack handler — no special path. The training match is just a
// container that adds the safe-reset + round-counting affordance on top
// of existing combat. Co-evolution is automatic.

import { Router } from "express";
import crypto from "node:crypto";

export default function createTrainingMatchRouter({ db, requireAuth, emitToUser }) {
  const router = Router();
  const auth = typeof requireAuth === "function" && requireAuth.length === 0
    ? requireAuth()
    : requireAuth;

  function uidFrom(req) {
    return req.user?.id || req.headers["x-user-id"] || null;
  }

  function loadMatch(id) {
    return db.prepare(`SELECT * FROM training_matches WHERE id = ?`).get(id);
  }

  function isParticipant(match, userId) {
    return match.initiator_id === userId || match.opponent_id === userId;
  }

  function emit(uid, event, payload) {
    try { emitToUser?.(uid, event, payload); } catch { /* best-effort */ }
  }

  // POST /challenge
  router.post("/challenge", auth, (req, res) => {
    try {
      const initiatorId = uidFrom(req);
      if (!initiatorId) return res.status(401).json({ ok: false, error: "auth_required" });
      const { opponentId, mode = "training", maxRounds = 20, hpThreshold = 0.5 } = req.body || {};
      if (!opponentId) return res.status(400).json({ ok: false, error: "opponentId_required" });
      if (opponentId === initiatorId) return res.status(400).json({ ok: false, error: "cannot_challenge_self" });

      // One active match per player
      const existing = db.prepare(`
        SELECT id FROM training_matches
        WHERE status IN ('pending', 'active', 'reset')
          AND (initiator_id = ? OR opponent_id = ?)
        LIMIT 1
      `).get(initiatorId, initiatorId);
      if (existing) return res.status(409).json({ ok: false, error: "already_in_match", matchId: existing.id });

      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO training_matches
          (id, initiator_id, opponent_id, status, mode, hp_threshold, max_rounds)
        VALUES (?, ?, ?, 'pending', ?, ?, ?)
      `).run(id, initiatorId, opponentId, String(mode).slice(0, 32),
             Math.max(0.1, Math.min(0.9, Number(hpThreshold) || 0.5)),
             Math.max(1, Math.min(100, Math.floor(Number(maxRounds) || 20))));

      emit(opponentId, "training:challenge", {
        matchId: id, initiatorId, mode, maxRounds, hpThreshold,
      });

      res.json({ ok: true, matchId: id });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /:id/accept
  router.post("/:id/accept", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      const match = loadMatch(req.params.id);
      if (!match) return res.status(404).json({ ok: false, error: "match_not_found" });
      if (match.opponent_id !== userId) return res.status(403).json({ ok: false, error: "not_opponent" });
      if (match.status !== "pending") return res.status(409).json({ ok: false, error: "not_pending" });

      db.prepare(`UPDATE training_matches SET status = 'active' WHERE id = ?`).run(match.id);
      emit(match.initiator_id, "training:start", { matchId: match.id, opponentId: userId });
      emit(match.opponent_id,  "training:start", { matchId: match.id, opponentId: match.initiator_id });
      res.json({ ok: true, match: loadMatch(match.id) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /:id/safe-reset
  router.post("/:id/safe-reset", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      const match = loadMatch(req.params.id);
      if (!match) return res.status(404).json({ ok: false, error: "match_not_found" });
      if (!isParticipant(match, userId)) return res.status(403).json({ ok: false, error: "not_participant" });
      if (!["active", "reset"].includes(match.status)) {
        return res.status(409).json({ ok: false, error: "not_active" });
      }

      db.prepare(`UPDATE training_matches SET status = 'reset' WHERE id = ?`).run(match.id);

      // Restore both fighters' HP/stamina to full and emit a 3s safe-zone
      // bubble. The actual restore happens client-side via the realtime
      // event so both players see the heal animation simultaneously.
      const safeUntil = Date.now() + 3000;
      emit(match.initiator_id, "training:safe-reset", { matchId: match.id, requestedBy: userId, safeUntil });
      emit(match.opponent_id,  "training:safe-reset", { matchId: match.id, requestedBy: userId, safeUntil });

      // Server-side restore of resource bars for both fighters via
      // city-presence (best-effort; the client will also restore locally).
      // Dynamic import keeps the router file decoupled from the presence
      // module's load order during test harness setup.
      import("../lib/city-presence.js").then((cp) => {
        cp.restorePlayerBars?.(match.initiator_id);
        cp.restorePlayerBars?.(match.opponent_id);
      }).catch(() => { /* fallback to client-side restore via realtime */ });

      // After the safe zone window, flip back to active automatically
      setTimeout(() => {
        const fresh = loadMatch(match.id);
        if (fresh?.status === "reset") {
          db.prepare(`UPDATE training_matches SET status = 'active' WHERE id = ?`).run(match.id);
          emit(match.initiator_id, "training:resume", { matchId: match.id });
          emit(match.opponent_id,  "training:resume", { matchId: match.id });
        }
      }, 3000);

      res.json({ ok: true, safeUntil });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /:id/round-end — fires from server-internal combat handler when
  // a kill lands while both fighters are in the same match.
  router.post("/:id/round-end", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      const match = loadMatch(req.params.id);
      if (!match) return res.status(404).json({ ok: false, error: "match_not_found" });
      if (!isParticipant(match, userId)) return res.status(403).json({ ok: false, error: "not_participant" });
      const { winnerId, durationMs, initiatorChain = "", opponentChain = "" } = req.body || {};
      if (winnerId && !isParticipant(match, winnerId)) {
        return res.status(400).json({ ok: false, error: "winner_not_participant" });
      }

      const roundNumber = match.rounds_played + 1;
      db.prepare(`
        INSERT INTO training_match_rounds
          (id, match_id, round_number, winner_id, duration_ms, initiator_chain, opponent_chain)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(), match.id, roundNumber,
        winnerId || null,
        Math.max(0, Math.floor(Number(durationMs) || 0)),
        String(initiatorChain).slice(0, 1024),
        String(opponentChain).slice(0, 1024),
      );

      const updates = [`rounds_played = rounds_played + 1`];
      if (winnerId === match.initiator_id) updates.push(`initiator_wins = initiator_wins + 1`);
      else if (winnerId === match.opponent_id) updates.push(`opponent_wins = opponent_wins + 1`);

      db.prepare(`UPDATE training_matches SET ${updates.join(", ")} WHERE id = ?`).run(match.id);

      const updated = loadMatch(match.id);
      // Auto-end when round cap reached
      if (updated.rounds_played >= updated.max_rounds) {
        db.prepare(`
          UPDATE training_matches
          SET status = 'ended', ended_reason = 'cap', ended_at = unixepoch()
          WHERE id = ?
        `).run(match.id);
        emit(match.initiator_id, "training:end", { matchId: match.id, reason: "cap", final: updated });
        emit(match.opponent_id,  "training:end", { matchId: match.id, reason: "cap", final: updated });
      }

      res.json({ ok: true, round: roundNumber, match: loadMatch(match.id) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /:id/forfeit
  router.post("/:id/forfeit", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      const match = loadMatch(req.params.id);
      if (!match) return res.status(404).json({ ok: false, error: "match_not_found" });
      if (!isParticipant(match, userId)) return res.status(403).json({ ok: false, error: "not_participant" });
      if (match.status === "ended") return res.json({ ok: true, alreadyEnded: true });

      db.prepare(`
        UPDATE training_matches
        SET status = 'ended', ended_reason = 'forfeit', ended_at = unixepoch()
        WHERE id = ?
      `).run(match.id);

      const reason = userId === match.initiator_id ? "initiator_forfeit" : "opponent_forfeit";
      emit(match.initiator_id, "training:end", { matchId: match.id, reason });
      emit(match.opponent_id,  "training:end", { matchId: match.id, reason });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /me
  router.get("/me", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      const match = db.prepare(`
        SELECT * FROM training_matches
        WHERE status IN ('pending', 'active', 'reset')
          AND (initiator_id = ? OR opponent_id = ?)
        ORDER BY created_at DESC LIMIT 1
      `).get(userId, userId);
      res.json({ ok: true, match: match || null });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /:id (with rounds)
  router.get("/:id", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      const match = loadMatch(req.params.id);
      if (!match) return res.status(404).json({ ok: false, error: "match_not_found" });
      if (!isParticipant(match, userId)) return res.status(403).json({ ok: false, error: "not_participant" });
      const rounds = db.prepare(`
        SELECT * FROM training_match_rounds WHERE match_id = ? ORDER BY round_number ASC
      `).all(match.id);
      res.json({ ok: true, match, rounds });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
