/**
 * Shield Routes — Security endpoints for Concord Shield
 *
 * 8 endpoints, all through the chat rail. No separate app. No settings.
 *
 * POST /api/shield/scan          — submit file/hash/URL for analysis
 * GET  /api/shield/status        — user's security status and score
 * GET  /api/shield/threats       — global threat feed from lattice
 * GET  /api/shield/threats/:id   — specific threat DTU details
 * POST /api/shield/report        — user reports suspected threat
 * GET  /api/shield/firewall      — current active firewall rules
 * GET  /api/shield/predictions   — prophet's predicted upcoming threats
 * POST /api/shield/sweep         — full system sweep request
 */

import { asyncHandler } from "../lib/async-handler.js";

export default function registerShieldRoutes(app, {
  STATE,
  makeCtx,
  runMacro,
  uiJson,
  uid,
  validate,
  perEndpointRateLimit,
}) {

  // Rate limit: 20 scans/min per user
  const shieldRateLimit = perEndpointRateLimit
    ? perEndpointRateLimit("shield.scan")
    : ((_req, _res, next) => next());

  // POST /api/shield/scan — Submit file/hash/URL for analysis
  app.post("/api/shield/scan", shieldRateLimit, asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("shield", "scan", req.body, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/shield/status — User's security status and score
  app.get("/api/shield/status", asyncHandler(async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const out = await runMacro("shield", "status", { userId }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/shield/threats — Global threat feed from lattice
  app.get("/api/shield/threats", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const subtype = req.query.subtype || null;
      const out = await runMacro("shield", "threats", { limit, subtype }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/shield/threats/:id — Specific threat DTU details
  app.get("/api/shield/threats/:id", asyncHandler(async (req, res) => {
    try {
      const threatId = req.params.id;
      const dtu = STATE.dtus?.get(threatId);
      if (!dtu || dtu.type !== "THREAT") {
        return res.status(404).json({ ok: false, error: "Threat not found" });
      }
      return res.json({
        ok: true,
        threat: dtu,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // POST /api/shield/report — User reports suspected threat
  app.post("/api/shield/report", shieldRateLimit, asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("shield", "report", req.body, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/shield/firewall — Current active firewall rules
  app.get("/api/shield/firewall", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("shield", "firewall", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/shield/predictions — Prophet's predicted upcoming threats
  app.get("/api/shield/predictions", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      const out = await runMacro("shield", "predictions", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // POST /api/shield/sweep — Full system sweep request
  app.post("/api/shield/sweep", shieldRateLimit, asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("shield", "sweep", req.body, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));
}
