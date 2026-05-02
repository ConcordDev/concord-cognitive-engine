/**
 * City Assets Routes — visual asset registry for city environments.
 *
 * Mount with: app.use('/api/city-assets', cityAssetsRouter)
 */

import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import {
  registerAsset,
  getAsset,
  listAssets,
  listAssetsBySlot,
  getBaseAssets,
  validateGLBUpload,
  createCharacterProfile,
  getCharacterProfile,
  getAssetStats,
  ASSET_CATEGORIES,
  ASSET_THEMES,
  CHARACTER_SLOTS,
} from "../lib/city-assets.js";

export default function createCityAssetsRouter({ requireAuth } = {}) {
  const router = Router();
  const auth = requireAuth ? requireAuth() : (_req, _res, next) => next();

  // GET /api/city-assets — list assets with optional category/theme filters (paginated)
  // Query params: page (1-based, default 1), limit (default 20, max 100)
  router.get("/", asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    // listAssets handles filtering/sorting and returns { items, total }
    const { items, total } = listAssets({ ...req.query, limit, offset });
    res.json({ ok: true, assets: items, data: items, pagination: { page, limit, total, hasMore: offset + limit < total }, categories: ASSET_CATEGORIES, themes: ASSET_THEMES });
  }));

  // GET /api/city-assets/stats — overall asset stats
  router.get("/stats", asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...getAssetStats() });
  }));

  // GET /api/city-assets/base — get base/starter assets
  router.get("/base", asyncHandler(async (_req, res) => {
    res.json({ ok: true, assets: getBaseAssets() });
  }));

  // GET /api/city-assets/slots — list assets by character slot
  router.get("/slots/:slot", asyncHandler(async (req, res) => {
    const assets = listAssetsBySlot(req.params.slot);
    res.json({ ok: true, assets, slots: CHARACTER_SLOTS });
  }));

  // GET /api/city-assets/:id — get a specific asset
  router.get("/:id", asyncHandler(async (req, res) => {
    const asset = getAsset(req.params.id);
    if (!asset) return res.status(404).json({ ok: false, error: "Asset not found" });
    res.json({ ok: true, asset });
  }));

  // POST /api/city-assets — register a new asset
  router.post("/", auth, asyncHandler(async (req, res) => {
    const asset = registerAsset(req.body);
    res.status(201).json({ ok: true, asset });
  }));

  // POST /api/city-assets/character — create or update character profile
  router.post("/character", auth, asyncHandler(async (req, res) => {
    const userId = req.user?.id ?? req.body.userId;
    if (!userId) return res.status(400).json({ ok: false, error: "userId required" });
    const profile = createCharacterProfile(userId, req.body.slots ?? {});
    res.json({ ok: true, profile, availableSlots: CHARACTER_SLOTS });
  }));

  // GET /api/city-assets/character/:userId — get character profile
  router.get("/character/:userId", asyncHandler(async (req, res) => {
    const profile = getCharacterProfile(req.params.userId);
    if (!profile) return res.status(404).json({ ok: false, error: "Profile not found" });
    res.json({ ok: true, profile });
  }));

  // POST /api/city-assets/validate-glb — validate a GLB file before upload
  router.post("/validate-glb", auth, asyncHandler(async (req, res) => {
    const { fileSize, category } = req.body;
    const result = validateGLBUpload(fileSize, category);
    res.json({ ok: true, ...result });
  }));

  return router;
}
