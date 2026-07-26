/**
 * Foundation Atlas Routes — Signal Tomography API endpoints
 *
 * 8 endpoints for volumetric mapping:
 *
 * GET  /api/atlas/tile         — retrieve map tile by coordinates
 * GET  /api/atlas/volume       — retrieve 3D volume for an area
 * GET  /api/atlas/material     — material classification at a point
 * GET  /api/atlas/subsurface   — underground features for an area
 * GET  /api/atlas/change       — temporal changes in an area
 * GET  /api/atlas/coverage     — current mapping coverage and resolution
 * GET  /api/atlas/live         — real-time signal tomography feed status
 * POST /api/atlas/query        — custom spatial query
 */

import { asyncHandler } from "../lib/async-handler.js";

export default function registerAtlasRoutes(app, {
  makeCtx,
  runMacro,
  perEndpointRateLimit,
}) {

  const queryRateLimit = perEndpointRateLimit
    ? perEndpointRateLimit("atlas.query")
    : ((_req, _res, next) => next());

  // GET /api/atlas/tile — Retrieve map tile by coordinates
  app.get("/api/atlas/tile", asyncHandler(async (req, res) => {
    try {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const out = await runMacro("atlas", "tile", { lat, lng }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/atlas/volume — Retrieve 3D volume for an area
  app.get("/api/atlas/volume", asyncHandler(async (req, res) => {
    try {
      const lat_min = Number(req.query.lat_min);
      const lat_max = Number(req.query.lat_max);
      const lng_min = Number(req.query.lng_min);
      const lng_max = Number(req.query.lng_max);
      const tier = req.query.tier || "PUBLIC";
      const out = await runMacro("atlas", "volume", { lat_min, lat_max, lng_min, lng_max, tier }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/atlas/material — Material classification at a point
  app.get("/api/atlas/material", asyncHandler(async (req, res) => {
    try {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const out = await runMacro("atlas", "material", { lat, lng }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/atlas/subsurface — Underground features for an area
  app.get("/api/atlas/subsurface", asyncHandler(async (req, res) => {
    try {
      const lat_min = Number(req.query.lat_min);
      const lat_max = Number(req.query.lat_max);
      const lng_min = Number(req.query.lng_min);
      const lng_max = Number(req.query.lng_max);
      const tier = req.query.tier || "RESEARCH";
      const out = await runMacro("atlas", "subsurface", { lat_min, lat_max, lng_min, lng_max, tier }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/atlas/change — Temporal changes in an area
  app.get("/api/atlas/change", asyncHandler(async (req, res) => {
    try {
      const lat_min = Number(req.query.lat_min) || undefined;
      const lat_max = Number(req.query.lat_max) || undefined;
      const lng_min = Number(req.query.lng_min) || undefined;
      const lng_max = Number(req.query.lng_max) || undefined;
      const since = req.query.since;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const bounds = (lat_min && lat_max && lng_min && lng_max)
        ? { lat_min, lat_max, lng_min, lng_max } : undefined;
      const out = await runMacro("atlas", "change", { bounds, since, limit }, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/atlas/coverage — Current mapping coverage and resolution
  app.get("/api/atlas/coverage", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("atlas", "coverage", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // GET /api/atlas/live — Real-time signal tomography feed status
  app.get("/api/atlas/live", asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("atlas", "live", {}, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));

  // POST /api/atlas/query — Custom spatial query
  app.post("/api/atlas/query", queryRateLimit, asyncHandler(async (req, res) => {
    try {
      const out = await runMacro("atlas", "query", req.body, makeCtx(req));
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }));
}
