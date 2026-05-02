// server/routes/concord-link.js
// Cross-world communication endpoints. Mounted at /api/concord-link.
//
//   POST  /send                     — send a message (cost charged via wallet)
//   GET   /inbox                    — list messages received by the auth'd user
//   POST  /:id/read                 — mark a message read
//   GET   /anchors/:worldId         — list anchor points for a world (public)
//   GET   /shadow-burn/me           — current Shadow Burn state for auth'd user

import { Router } from "express";
import {
  sendMessage,
  listInbox,
  markRead,
  listAnchorsForWorld,
  computeMessageCost,
  applyShadowBurn,
} from "../lib/concord-link.js";

export default function createConcordLinkRouter({ requireAuth, db, emitToUser }) {
  const router = Router();
  const auth = requireAuth;
  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;

  // GET /api/concord-link/anchors/:worldId — public read, no auth
  router.get("/anchors/:worldId", (req, res) => {
    try {
      const anchors = listAnchorsForWorld(db, req.params.worldId);
      res.json({ ok: true, anchors });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // GET /api/concord-link/cost — preview cost before sending
  router.get("/cost", (req, res) => {
    try {
      const messageType = String(req.query.messageType || "text");
      const sourceWorld = String(req.query.sourceWorld || "");
      const destWorld = String(req.query.destWorld || "");
      const encryption = String(req.query.encryption || "basic");
      if (!sourceWorld || !destWorld) {
        return res.status(400).json({ ok: false, error: "sourceWorld and destWorld required" });
      }
      const result = computeMessageCost({ messageType, sourceWorld, destWorld, encryption });
      res.json({ ok: true, ...result });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/concord-link/send
  router.post("/send", auth, (req, res) => {
    try {
      const senderId = _userId(req);
      const {
        receiverId, receiverKind = "user",
        sourceWorld, destWorld,
        messageType = "text",
        payload,
        encryption = "basic",
        emotionalWeight = 0,
      } = req.body || {};

      if (!sourceWorld || !destWorld) {
        return res.status(400).json({ ok: false, error: "sourceWorld and destWorld required" });
      }

      // Note: this route does NOT charge the sender's wallet automatically
      // — the cost is recorded but a downstream wallet hook needs to debit.
      // Hooked into the existing economy in a follow-up commit.
      const result = sendMessage(db, {
        senderId, senderKind: "user",
        receiverId, receiverKind,
        sourceWorld, destWorld,
        messageType, payload,
        encryption,
        emotionalWeight: Math.max(0, Math.min(1, Number(emotionalWeight) || 0)),
      }, { emitToUser });

      if (!result.ok) {
        const status = result.reason === "shadow_burn_cooldown" ? 429 : 400;
        return res.status(status).json(result);
      }
      res.status(201).json(result);
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // GET /api/concord-link/inbox
  router.get("/inbox", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const messages = listInbox(db, userId, { limit });
      res.json({ ok: true, messages });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/concord-link/:id/read
  router.post("/:id/read", auth, (req, res) => {
    try {
      const userId = _userId(req);
      markRead(db, req.params.id, userId);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // GET /api/concord-link/shadow-burn/me — current burn state (read-only)
  router.get("/shadow-burn/me", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const row = db.prepare(`SELECT * FROM concord_link_shadow_burn WHERE sender_id = ?`).get(userId);
      res.json({
        ok: true,
        state: row || { sender_id: userId, messages_today: 0, burn_severity: 0, cooldown_until: null },
      });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  return router;
}
