// server/routes/concord-link-walkers.js
// Walker bazaar + journey tracking endpoints. Mounted at /api/concord-link/walkers.
//
//   GET   /                          — list available walkers (optional ?homeWorld=)
//   POST  /hire                      — hire a walker for a physical message
//                                      body: { walkerId, sourceWorld, destWorld, messageId? }
//                                      Note: this records the contract; the
//                                      sparks fee is debited via the existing
//                                      /api/concord-link/send flow when a
//                                      physical message is sent. /hire is
//                                      currently fee=0 unless caller specifies.
//   GET   /track/:contractId         — read-only journey state
//
// The GETs here are public-readable (no auth) — adding to publicReadPaths in
// server.js when the router is mounted. /hire requires auth.

import { Router } from "express";
import {
  listAvailableWalkers,
  hireWalker,
  trackWalker,
} from "../lib/concord-link-walkers.js";

export default function createConcordLinkWalkersRouter({ requireAuth, db }) {
  const router = Router();
  const auth = typeof requireAuth === "function" && requireAuth.length === 0 ? requireAuth() : requireAuth;
  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;

  // GET /api/concord-link/walkers
  router.get("/", (req, res) => {
    try {
      const homeWorld = req.query.homeWorld ? String(req.query.homeWorld) : null;
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const walkers = listAvailableWalkers(db, { homeWorld, limit });
      res.json({ ok: true, walkers });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/concord-link/walkers/hire
  router.post("/hire", auth, (req, res) => {
    try {
      const payerId = _userId(req);
      if (!payerId) return res.status(401).json({ ok: false, error: "auth_required" });
      const { walkerId, sourceWorld, destWorld, messageId = null, feeSparks = 0 } = req.body || {};
      const result = hireWalker(db, { walkerId, payerId, sourceWorld, destWorld, messageId, feeSparks });
      if (!result.ok) return res.status(400).json(result);
      res.status(201).json(result);
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // GET /api/concord-link/walkers/track/:contractId
  router.get("/track/:contractId", (req, res) => {
    try {
      const view = trackWalker(db, req.params.contractId);
      if (!view) return res.status(404).json({ ok: false, error: "contract_not_found" });
      res.json({ ok: true, ...view });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  return router;
}
