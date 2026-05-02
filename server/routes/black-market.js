// server/routes/black-market.js
// Sael's stall — the in-fiction interface to intercepted Concord Link messages.
//
//   GET   /                         — browse active listings (optional ?fence=)
//   POST  /:id/purchase             — buy a listing with sparks (auth required)
//   GET   /reputation               — your reputation across fences (auth)
//
// Listings are seeded by the heartbeat tick when intercepted journeys land
// (see server.js governorTick walker hook → surfaceInterceptedMessage).
// There is no /list endpoint exposed to players because surfacing must come
// from a real interception event, not a player-authored sale.

import { Router } from "express";
import {
  browseListings,
  purchaseListing,
  getBuyerReputation,
} from "../lib/black-market.js";

export default function createBlackMarketRouter({ requireAuth, db }) {
  const router = Router();
  const auth = requireAuth;
  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;

  // GET /api/black-market — public browse (no sender/receiver visible)
  router.get("/", (req, res) => {
    try {
      const fenceNpcId = req.query.fence ? String(req.query.fence) : null;
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const listings = browseListings(db, { fenceNpcId, limit });
      res.json({ ok: true, listings });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/black-market/:id/purchase — buy with sparks
  router.post("/:id/purchase", auth, (req, res) => {
    try {
      const buyerId = _userId(req);
      if (!buyerId) return res.status(401).json({ ok: false, error: "auth_required" });
      const result = purchaseListing(db, { listingId: req.params.id, buyerId });
      if (!result.ok) {
        const status = result.reason === "insufficient_sparks" ? 402 : 400;
        return res.status(status).json(result);
      }
      res.status(201).json(result);
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // GET /api/black-market/reputation — your rep across fences
  router.get("/reputation", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const rep = getBuyerReputation(db, userId);
      res.json({ ok: true, reputation: rep });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  return router;
}
