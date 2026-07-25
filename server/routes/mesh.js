/**
 * Mesh Routes — Network transport endpoints for Concord Mesh
 *
 * 9 endpoints, all through the chat rail. No separate app. No settings.
 *
 * GET  /api/mesh/status       — node connectivity across all channels
 * GET  /api/mesh/topology     — local mesh map of discovered nodes
 * GET  /api/mesh/channels     — available transport layers and their status
 * POST /api/mesh/send         — send DTU with automatic routing
 * GET  /api/mesh/pending      — store-and-forward queue
 * GET  /api/mesh/stats        — transmission statistics per channel
 * POST /api/mesh/relay        — configure relay preferences
 * GET  /api/mesh/peers        — discovered peers across all channels
 * POST /api/mesh/transfer     — initiate consciousness transfer with multi-path
 */

import { asyncHandler } from "../lib/async-handler.js";

export default function registerMeshRoutes(app, {
  STATE,
  makeCtx,
  runMacro,
  perEndpointRateLimit,
}) {

  // Rate limit: 30 sends/min per user
  const meshRateLimit = perEndpointRateLimit
    ? perEndpointRateLimit("mesh.send")
    : ((_req, _res, next) => next());

  // GET /api/mesh/status — Node connectivity status
  app.get("/api/mesh/status", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("mesh", "status", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/mesh/topology — Local mesh map
  app.get("/api/mesh/topology", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("mesh", "topology", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/mesh/channels — Available transport layers
  app.get("/api/mesh/channels", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("mesh", "channels", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // POST /api/mesh/send — Send DTU with automatic routing
  app.post("/api/mesh/send", meshRateLimit, asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("mesh", "send", req.body, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/mesh/pending — Store-and-forward queue
  app.get("/api/mesh/pending", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("mesh", "pending", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/mesh/stats — Transmission statistics
  app.get("/api/mesh/stats", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("mesh", "stats", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // POST /api/mesh/relay — Configure relay preferences
  app.post("/api/mesh/relay", meshRateLimit, asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("mesh", "relay", req.body, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/mesh/peers — Discovered peers
  app.get("/api/mesh/peers", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const out = await runMacro("mesh", "peers", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // POST /api/mesh/transfer — Initiate consciousness transfer
  app.post("/api/mesh/transfer", meshRateLimit, asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("mesh", "transfer", req.body, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));
}
