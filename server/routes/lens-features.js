/**
 * Lens Features Routes
 *
 * REST API for browsing, searching, and querying the complete
 * lens feature specification — Concord Coin integration, DTU economics,
 * merit credit, compression, preview system, remix/citation economy,
 * crew attribution, USB integration, bot/emergent access, and
 * cross-lens economics.
 */

import { Router } from "express";
import {
  seedLensFeatures,
  getLensFeatures,
  getFeature,
  browseFeatures,
  getAllLensFeatureSummaries,
  getFeatureStats,
  searchFeatures,
} from "../economy/lens-features-service.js";

import { UNIVERSAL_FEATURES } from "../lib/lens-features.js";
import * as basicCrudTemplate from "../lib/lens-templates/basic-crud.js";
import * as marketplaceTemplate from "../lib/lens-templates/marketplace.js";
import * as visualizationTemplate from "../lib/lens-templates/visualization.js";

const LENS_TEMPLATES = {
  [basicCrudTemplate.id]: basicCrudTemplate,
  [marketplaceTemplate.id]: marketplaceTemplate,
  [visualizationTemplate.id]: visualizationTemplate,
};

export default function lensFeatureRoutes(db, lensFeatures) {
  const router = Router();

  /**
   * GET /api/lens-features/stats
   * Feature statistics across all lenses
   */
  router.get("/stats", (_req, res) => {
    const stats = getFeatureStats(db);
    res.json(stats);
  });

  /**
   * GET /api/lens-features/summaries
   * All lens feature summaries
   */
  router.get("/summaries", (_req, res) => {
    const result = getAllLensFeatureSummaries(db);
    res.json(result);
  });

  /**
   * GET /api/lens-features/browse
   * Browse features with filters: lensId, category, status, search
   */
  router.get("/browse", (req, res) => {
    const { lensId, category, status, search, limit, offset } = req.query;
    const result = browseFeatures(db, {
      lensId: lensId || undefined,
      category: category || undefined,
      status: status || undefined,
      search: search || undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json(result);
  });

  /**
   * GET /api/lens-features/search
   * Search features across all lenses
   */
  router.get("/search", (req, res) => {
    const { q } = req.query;
    if (!q) return res.json({ ok: true, results: [], count: 0 });
    const result = searchFeatures(db, q);
    res.json(result);
  });

  /**
   * GET /api/lens-features/universal
   * Get the 20 universal features that apply to ALL 112 lenses
   */
  router.get("/universal", (_req, res) => {
    res.json({
      ok: true,
      features: UNIVERSAL_FEATURES,
      count: UNIVERSAL_FEATURES.length,
      description: "These features apply to every lens across the entire Concord platform",
    });
  });

  // ── Lens Templates (must be before /:lensId wildcard) ────────────────────

  router.get("/templates", (_req, res) => {
    const templates = Object.values(LENS_TEMPLATES).map(t => ({
      id: t.id, name: t.name, description: t.description, category: t.category, tags: t.tags,
    }));
    res.json({ ok: true, templates });
  });

  router.post("/generate", (req, res) => {
    const { template, config = {} } = req.body;
    const tmpl = LENS_TEMPLATES[template];
    if (!tmpl) {
      return res.status(400).json({ ok: false, error: `Unknown template: "${template}". Available: ${Object.keys(LENS_TEMPLATES).join(", ")}` });
    }
    try {
      const lens = tmpl.generate(config);
      res.json({ ok: true, lens });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post("/seed", (_req, res) => {
    const result = seedLensFeatures(db, lensFeatures);
    res.json(result);
  });

  router.get("/:lensId", (req, res) => {
    const result = getLensFeatures(db, req.params.lensId);
    res.json(result);
  });

  router.get("/:lensId/:featureId", (req, res) => {
    const result = getFeature(db, req.params.lensId, req.params.featureId);
    res.json(result);
  });

  return router;
}
