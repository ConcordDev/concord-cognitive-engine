/**
 * Atlas Signal Cortex Routes — Signal classification, privacy zones, spectrum
 *
 * Signal Cortex:
 * GET  /api/atlas/signals/taxonomy    — signal classification tree
 * GET  /api/atlas/signals/unknown     — unclassified signals
 * GET  /api/atlas/signals/anomalies   — detected anomalies
 * POST /api/atlas/signals/classify    — submit classification
 * GET  /api/atlas/signals/spectrum    — spectral occupancy
 *
 * Privacy:
 * GET  /api/atlas/privacy/zones       — privacy zone map
 * POST /api/atlas/privacy/verify      — verify zone integrity
 * GET  /api/atlas/privacy/stats       — aggregate stats only
 */

import { asyncHandler } from "../lib/async-handler.js";

export default function registerAtlasSignalRoutes(app, {
  makeCtx,
  runMacro,
  perEndpointRateLimit,
}) {

  const classifyRateLimit = perEndpointRateLimit
    ? perEndpointRateLimit("cortex.classify")
    : ((_req, _res, next) => next());

  // ── Signal Cortex Endpoints ─────────────────────────────────────────────

  // GET /api/atlas/signals/taxonomy — Signal classification tree
  app.get("/api/atlas/signals/taxonomy", asyncHandler(async (req, res) => {
    try {
      const category = req.query.category || "all";
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("cortex", "taxonomy", { category, limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/atlas/signals/unknown — Unclassified signals
  app.get("/api/atlas/signals/unknown", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("cortex", "unknown", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/atlas/signals/anomalies — Detected anomalies
  app.get("/api/atlas/signals/anomalies", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("cortex", "anomalies", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // POST /api/atlas/signals/classify — Submit signal for classification
  app.post("/api/atlas/signals/classify", classifyRateLimit, asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("cortex", "classify", req.body, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/atlas/signals/spectrum — Spectral occupancy
  app.get("/api/atlas/signals/spectrum", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("cortex", "spectrum", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // ── Privacy Endpoints ───────────────────────────────────────────────────

  // GET /api/atlas/privacy/zones — Privacy zone map
  app.get("/api/atlas/privacy/zones", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("cortex", "privacy.zones", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // POST /api/atlas/privacy/verify — Verify zone integrity
  app.post("/api/atlas/privacy/verify", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("cortex", "privacy.verify", req.body, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/atlas/privacy/stats — Aggregate privacy stats
  app.get("/api/atlas/privacy/stats", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("cortex", "privacy.stats", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));
}
