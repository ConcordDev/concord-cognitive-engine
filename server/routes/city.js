/**
 * City API Routes
 *
 * REST endpoints for city management:
 *   - GET    /api/cities          — list/browse public city directory
 *   - GET    /api/cities/home     — get user's home city
 *   - GET    /api/cities/:id      — get city details
 *   - POST   /api/cities          — create a new city
 *   - PUT    /api/cities/:id      — update city config (owner only)
 *   - DELETE /api/cities/:id      — delete city (owner only)
 *   - POST   /api/cities/:id/join    — join a city
 *   - POST   /api/cities/:id/leave   — leave a city
 *   - GET    /api/cities/:id/players — get active players
 *   - POST   /api/cities/home     — set home city
 */

import { Router } from "express";
import logger from "../logger.js";
import {
  createCity,
  getCity,
  updateCity,
  deleteCity,
  listCities,
  joinCity,
  leaveCity,
  getCityPlayers,
  getCityDirectory,
  setHomeCity,
  getHomeCity,
} from "../lib/city-manager.js";

/**
 * @param {object} [opts]
 * @param {Function} [opts.requireAuth] - Auth middleware
 * @returns {Router}
 */
export default function createCityRoutes({ requireAuth } = {}) {
  const router = Router();

  /** Extract userId from authenticated request */
  function _userId(req) {
    return req.user?.userId ?? req.actor?.userId ?? null;
  }

  /** Auth guard — passes through if no requireAuth configured */
  const auth = (req, res, next) => {
    if (requireAuth) return requireAuth(req, res, next);
    next();
  };

  // ── GET /api/cities — list / browse public directory ──────────────────────

  router.get("/", (req, res) => {
    try {
      const { visibility, sortBy, limit, offset } = req.query;
      const result = listCities({
        visibility: visibility || "public",
        sortBy: sortBy || "newest",
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      logger.warn?.("[city-route] list error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /api/cities/home — get user's home city ───────────────────────────
  // NOTE: Must be defined BEFORE /:id to avoid "home" matching as an :id param

  router.get("/home", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "authentication_required" });

      const city = getHomeCity(userId);
      res.json({ ok: true, city });
    } catch (err) {
      logger.warn?.("[city-route] get home error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /api/cities/home — set home city ─────────────────────────────────

  router.post("/home", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "authentication_required" });

      const { cityId } = req.body || {};
      if (!cityId) return res.status(400).json({ ok: false, error: "cityId is required" });

      const result = setHomeCity(userId, cityId);
      res.json({ ok: true, ...result });
    } catch (err) {
      logger.warn?.("[city-route] set home error:", err.message);
      const status = err.message.includes("not found") ? 404 : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  // ── GET /api/cities/:id — get city details ────────────────────────────────

  router.get("/:id", (req, res) => {
    try {
      const city = getCity(req.params.id);
      if (!city) return res.status(404).json({ ok: false, error: "city_not_found" });
      res.json({ ok: true, city });
    } catch (err) {
      logger.warn?.("[city-route] get error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /api/cities — create a new city ──────────────────────────────────

  router.post("/", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "authentication_required" });

      const city = createCity({ ...req.body, owner: userId });
      res.status(201).json({ ok: true, city });
    } catch (err) {
      logger.warn?.("[city-route] create error:", err.message);
      const status = err.message.includes("required") || err.message.includes("Invalid") ? 400 : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  // ── PUT /api/cities/:id — update city config (owner only) ─────────────────

  router.put("/:id", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "authentication_required" });

      const city = updateCity(req.params.id, req.body, userId);
      res.json({ ok: true, city });
    } catch (err) {
      logger.warn?.("[city-route] update error:", err.message);
      const status = err.message.includes("not found") ? 404
        : err.message.includes("owner") ? 403
        : err.message.includes("Invalid") ? 400
        : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  // ── DELETE /api/cities/:id — delete city (owner only) ─────────────────────

  router.delete("/:id", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "authentication_required" });

      deleteCity(req.params.id, userId);
      res.json({ ok: true, deleted: req.params.id });
    } catch (err) {
      logger.warn?.("[city-route] delete error:", err.message);
      const status = err.message.includes("not found") ? 404
        : err.message.includes("owner") || err.message.includes("Cannot delete") ? 403
        : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  // ── POST /api/cities/:id/join — join a city ──────────────────────────────

  router.post("/:id/join", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "authentication_required" });

      const result = joinCity(req.params.id, userId);
      res.json({ ok: true, ...result });
    } catch (err) {
      logger.warn?.("[city-route] join error:", err.message);
      const status = err.message.includes("not found") ? 404 : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  // ── POST /api/cities/:id/leave — leave a city ────────────────────────────

  router.post("/:id/leave", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "authentication_required" });

      const result = leaveCity(req.params.id, userId);
      res.json({ ok: true, ...result });
    } catch (err) {
      logger.warn?.("[city-route] leave error:", err.message);
      const status = err.message.includes("not found") ? 404 : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  // ── GET /api/cities/:id/players — get active players ──────────────────────

  router.get("/:id/players", (req, res) => {
    try {
      const players = getCityPlayers(req.params.id);
      res.json({ ok: true, cityId: req.params.id, count: players.length, players });
    } catch (err) {
      logger.warn?.("[city-route] players error:", err.message);
      const status = err.message.includes("not found") ? 404 : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  return router;
}
