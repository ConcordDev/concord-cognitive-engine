/**
 * Foundation Intelligence Routes — API endpoints for tiered intelligence
 *
 * 12 endpoints covering Public and Research tiers:
 *
 * Public Tier (7):
 * GET  /api/foundation/intel/weather      — global weather intelligence
 * GET  /api/foundation/intel/geology      — geological survey data
 * GET  /api/foundation/intel/energy       — energy distribution maps
 * GET  /api/foundation/intel/ocean        — ocean monitoring data
 * GET  /api/foundation/intel/seismic      — seismic monitoring
 * GET  /api/foundation/intel/agriculture  — agricultural intelligence
 * GET  /api/foundation/intel/environment  — environmental assessment
 *
 * Research Tier (5):
 * POST /api/foundation/intel/research/apply    — apply for research access
 * GET  /api/foundation/intel/research/status   — application status
 * GET  /api/foundation/intel/research/data     — authorized research data
 * GET  /api/foundation/intel/research/synthesis — cross-medium findings
 * GET  /api/foundation/intel/research/archive  — historical signal data
 *
 * Sovereign Tier: No API endpoints exist. By design and permanent.
 */

import { asyncHandler } from "../lib/async-handler.js";

export default function registerFoundationIntelRoutes(app, {
  makeCtx,
  runMacro,
  perEndpointRateLimit,
}) {

  const researchRateLimit = perEndpointRateLimit
    ? perEndpointRateLimit("foundation.intel.research")
    : ((_req, _res, next) => next());

  // ── Public Tier Endpoints ───────────────────────────────────────────────

  // GET /api/foundation/intel/weather — Global weather intelligence
  app.get("/api/foundation/intel/weather", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("intel", "weather", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/intel/geology — Geological survey data
  app.get("/api/foundation/intel/geology", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("intel", "geology", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/intel/energy — Energy distribution maps
  app.get("/api/foundation/intel/energy", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("intel", "energy", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/intel/ocean — Ocean monitoring data
  app.get("/api/foundation/intel/ocean", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("intel", "ocean", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/intel/seismic — Seismic monitoring
  app.get("/api/foundation/intel/seismic", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("intel", "seismic", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/intel/agriculture — Agricultural intelligence
  app.get("/api/foundation/intel/agriculture", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("intel", "agriculture", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/intel/environment — Environmental assessment
  app.get("/api/foundation/intel/environment", asyncHandler(async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("intel", "environment", { limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // ── Research Tier Endpoints ─────────────────────────────────────────────

  // POST /api/foundation/intel/research/apply — Apply for research access
  app.post("/api/foundation/intel/research/apply", researchRateLimit, asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("intel", "research.apply", req.body, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/intel/research/status — Application status
  app.get("/api/foundation/intel/research/status", asyncHandler(async (req, res) => {
    try {
      const applicationId = req.query.applicationId;
      const out = await runMacro("intel", "research.status", { applicationId }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/intel/research/data — Authorized research data
  app.get("/api/foundation/intel/research/data", asyncHandler(async (req, res) => {
    try {
      const researcherId = req.query.researcherId;
      const category = req.query.category;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("intel", "research.data", { researcherId, category, limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/intel/research/synthesis — Cross-medium findings
  app.get("/api/foundation/intel/research/synthesis", asyncHandler(async (req, res) => {
    try {
      const researcherId = req.query.researcherId;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("intel", "research.synthesis", { researcherId, limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/foundation/intel/research/archive — Historical signal data
  app.get("/api/foundation/intel/research/archive", asyncHandler(async (req, res) => {
    try {
      const researcherId = req.query.researcherId;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const out = await runMacro("intel", "research.archive", { researcherId, limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));
}
