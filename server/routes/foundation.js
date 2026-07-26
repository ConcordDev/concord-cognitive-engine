/**
 * Foundation Routes — API endpoints for all Foundation sovereignty modules
 *
 * 17 endpoints covering all 10 Foundation modules:
 *
 * GET  /api/foundation/status              — all module status
 * GET  /api/foundation/sense/readings      — current sensor data
 * GET  /api/foundation/sense/patterns      — detected patterns
 * GET  /api/foundation/identity/verify     — verify node identity
 * GET  /api/foundation/energy/map          — energy distribution map
 * GET  /api/foundation/energy/grid         — grid health status
 * GET  /api/foundation/spectrum/map        — spectrum occupancy
 * GET  /api/foundation/spectrum/available  — usable channels
 * POST /api/foundation/emergency/alert     — trigger emergency mode
 * GET  /api/foundation/emergency/status    — disaster zone status
 * GET  /api/foundation/market/earnings     — relay earnings
 * GET  /api/foundation/market/topology     — relay node map
 * GET  /api/foundation/archive/fossils     — discovered legacy signals
 * GET  /api/foundation/archive/decoded     — decoded historical data
 * GET  /api/foundation/synthesis/correlations — cross-medium patterns
 * GET  /api/foundation/neural/readiness    — BCI preparation status
 * GET  /api/foundation/protocol/stats      — Concord Protocol metrics
 */

import { asyncHandler } from "../lib/async-handler.js";

export default function registerFoundationRoutes(app, {
  makeCtx,
  runMacro,
  perEndpointRateLimit,
}) {

  const foundationRateLimit = perEndpointRateLimit
    ? perEndpointRateLimit("foundation.emergency")
    : ((_req, _res, next) => next());

  // GET /api/foundation/status — All module status
  app.get("/api/foundation/status", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("foundation", "status", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/sense/readings — Current sensor data
  app.get("/api/foundation/sense/readings", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("foundation", "sense.readings", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/sense/patterns — Detected patterns
  app.get("/api/foundation/sense/patterns", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("foundation", "sense.patterns", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/identity/verify — Verify node identity
  app.get("/api/foundation/identity/verify", asyncHandler(async (req, res) => {
    try {
      const nodeId = req.query.nodeId;
      const out = await runMacro("foundation", "identity.verify", { nodeId }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/energy/map — Energy distribution map
  app.get("/api/foundation/energy/map", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("foundation", "energy.map", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/energy/grid — Grid health status
  app.get("/api/foundation/energy/grid", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("foundation", "energy.grid", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/spectrum/map — Spectrum occupancy
  app.get("/api/foundation/spectrum/map", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("foundation", "spectrum.map", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/spectrum/available — Usable channels
  app.get("/api/foundation/spectrum/available", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("foundation", "spectrum.available", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // POST /api/foundation/emergency/alert — Trigger emergency mode
  app.post("/api/foundation/emergency/alert", foundationRateLimit, asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("foundation", "emergency.alert", req.body, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/emergency/status — Disaster zone status
  app.get("/api/foundation/emergency/status", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("foundation", "emergency.status", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/market/earnings — Relay earnings
  app.get("/api/foundation/market/earnings", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("foundation", "market.earnings", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/market/topology — Relay node map
  app.get("/api/foundation/market/topology", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("foundation", "market.topology", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/archive/fossils — Discovered legacy signals
  app.get("/api/foundation/archive/fossils", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("foundation", "archive.fossils", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/archive/decoded — Decoded historical data
  app.get("/api/foundation/archive/decoded", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("foundation", "archive.decoded", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/synthesis/correlations — Cross-medium patterns
  app.get("/api/foundation/synthesis/correlations", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("foundation", "synthesis.correlations", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/neural/readiness — BCI preparation status
  app.get("/api/foundation/neural/readiness", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("foundation", "neural.readiness", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/protocol/stats — Concord Protocol metrics
  app.get("/api/foundation/protocol/stats", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("foundation", "protocol.stats", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));
}
