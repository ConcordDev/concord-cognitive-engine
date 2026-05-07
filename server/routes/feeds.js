/**
 * Feed Manager Admin Routes
 *
 * Provides REST API for managing feed sources:
 *   - GET /api/feeds — list all feeds + health dashboard
 *   - GET /api/feeds/health — full health dashboard
 *   - GET /api/feeds/domain/:domain — feeds for a specific domain
 *   - POST /api/feeds — register a new custom feed
 *   - PUT /api/feeds/:feedId/enable — enable a feed
 *   - PUT /api/feeds/:feedId/disable — disable a feed
 *   - PUT /api/feeds/:feedId/interval — update polling interval
 *   - DELETE /api/feeds/:feedId — remove a feed
 *   - POST /api/feeds/:feedId/test — test connectivity
 *   - POST /api/feeds/:feedId/tick — force-tick a feed
 *   - GET /api/feeds/domains — list all feed domains
 */

import { Router } from "express";
import logger from "../logger.js";

export default function createFeedRoutes({ requireAuth } = {}) {
  const router = Router();
  const fm = () => globalThis._feedManager;

  // Middleware: require admin for mutating operations
  const requireAdmin = (req, res, next) => {
    if (requireAuth) return requireAuth(req, res, next);
    next();
  };

  // GET /api/feeds — list all feeds
  router.get("/", (req, res) => {
    try {
      if (!fm()) return res.status(503).json({ ok: false, error: "feed_manager_not_initialized" });
      const feeds = fm().listFeeds();
      res.json({ ok: true, count: feeds.length, feeds });
    } catch (err) {
      logger.warn?.("[feeds-route] list error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/feeds/health — full health dashboard
  router.get("/health", (req, res) => {
    try {
      if (!fm()) return res.status(503).json({ ok: false, error: "feed_manager_not_initialized" });
      const dashboard = fm().getFeedHealthDashboard();
      res.json({ ok: true, ...dashboard });
    } catch (err) {
      logger.warn?.("[feeds-route] health error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/feeds/domains — list all feed domains
  router.get("/domains", (req, res) => {
    try {
      if (!fm()) return res.status(503).json({ ok: false, error: "feed_manager_not_initialized" });
      res.json({ ok: true, domains: fm().FEED_DOMAINS || [] });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/feeds/domain/:domain — feeds for a specific domain
  router.get("/domain/:domain", (req, res) => {
    try {
      if (!fm()) return res.status(503).json({ ok: false, error: "feed_manager_not_initialized" });
      const feeds = fm().listFeedsByDomain(req.params.domain);
      res.json({ ok: true, domain: req.params.domain, count: feeds.length, feeds });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/feeds — register a new custom feed
  router.post("/", requireAdmin, (req, res) => {
    try {
      if (!fm()) return res.status(503).json({ ok: false, error: "feed_manager_not_initialized" });
      const { id, name, domain, type, url, interval, parser, tags, enabled } = req.body;
      if (!id || !url) return res.status(400).json({ ok: false, error: "id and url are required" });
      const result = fm().registerFeed({ id, name, domain, type, url, interval, parser, tags, enabled });
      res.json(result);
    } catch (err) {
      logger.warn?.("[feeds-route] register error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // PUT /api/feeds/:feedId/enable — enable a feed
  router.put("/:feedId/enable", requireAdmin, (req, res) => {
    try {
      if (!fm()) return res.status(503).json({ ok: false, error: "feed_manager_not_initialized" });
      const result = fm().setFeedEnabled(req.params.feedId, true);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // PUT /api/feeds/:feedId/disable — disable a feed
  router.put("/:feedId/disable", requireAdmin, (req, res) => {
    try {
      if (!fm()) return res.status(503).json({ ok: false, error: "feed_manager_not_initialized" });
      const result = fm().setFeedEnabled(req.params.feedId, false);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // PUT /api/feeds/:feedId/interval — update polling interval
  router.put("/:feedId/interval", requireAdmin, (req, res) => {
    try {
      if (!fm()) return res.status(503).json({ ok: false, error: "feed_manager_not_initialized" });
      const { interval } = req.body;
      if (!interval || typeof interval !== "number") return res.status(400).json({ ok: false, error: "interval (number) is required" });
      const result = fm().setFeedInterval(req.params.feedId, interval);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // DELETE /api/feeds/:feedId — remove a feed
  router.delete("/:feedId", requireAdmin, (req, res) => {
    try {
      if (!fm()) return res.status(503).json({ ok: false, error: "feed_manager_not_initialized" });
      const result = fm().removeFeed(req.params.feedId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/feeds/:feedId/test — test connectivity
  router.post("/:feedId/test", requireAdmin, async (req, res) => {
    try {
      if (!fm()) return res.status(503).json({ ok: false, error: "feed_manager_not_initialized" });
      const result = await fm().testFeedConnectivity(req.params.feedId);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/feeds/:feedId/tick — force-tick a feed (manual refresh)
  router.post("/:feedId/tick", requireAdmin, async (req, res) => {
    try {
      if (!fm()) return res.status(503).json({ ok: false, error: "feed_manager_not_initialized" });
      const result = await fm().forceTick(req.params.feedId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/feeds/test-url — test an arbitrary URL for feed connectivity
  router.post("/test-url", requireAdmin, async (req, res) => {
    try {
      if (!fm()) return res.status(503).json({ ok: false, error: "feed_manager_not_initialized" });
      const { url } = req.body;
      if (!url) return res.status(400).json({ ok: false, error: "url is required" });
      const result = await fm().testFeedConnectivity(url);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
