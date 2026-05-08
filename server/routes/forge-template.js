/**
 * Forge Template Routes — Code Lens App Generation API
 *
 * Exposes the Forge template engine: template CRUD, preset management,
 * code generation, section preview, and DTU publishing.
 *
 * Routes:
 *   GET    /api/forge-template/stats              — Engine statistics
 *   GET    /api/forge-template/presets             — List starter presets
 *   GET    /api/forge-template/presets/:category   — Get preset details
 *   POST   /api/forge-template/from-preset         — Create template from preset
 *   POST   /api/forge-template/templates           — Create custom template
 *   GET    /api/forge-template/templates           — List templates
 *   GET    /api/forge-template/templates/:id       — Get template details
 *   PUT    /api/forge-template/templates/:id       — Update template
 *   DELETE /api/forge-template/templates/:id       — Delete template
 *   POST   /api/forge-template/templates/:id/generate   — Generate code
 *   GET    /api/forge-template/templates/:id/preview/:section — Preview section
 *   POST   /api/forge-template/templates/:id/publish    — Publish as DTU
 */

import { asyncHandler } from "../lib/async-handler.js";
import { ValidationError } from "../lib/errors.js";
import {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  generateTemplate,
  previewSection,
  publishTemplate,
  listPresets,
  getPreset,
  createFromPreset,
  getForgeStats,
  init as initForge,
} from "../emergent/forge-template-engine.js";

/**
 * Register Forge template routes on the Express app.
 *
 * @param {import('express').Express} app - Express application
 * @param {object} deps - Dependencies
 */
export default function registerForgeTemplateRoutes(app, deps = {}) {
  // Initialize the engine
  initForge(deps);

  const PREFIX = "/api/forge-template";

  // ── GET /stats — Engine statistics ────────────────────────────────────

  app.get(`${PREFIX}/stats`, asyncHandler(async (_req, res) => {
    const stats = getForgeStats();
    res.json(stats);
  }));

  // ── GET /presets — List available presets ──────────────────────────────

  app.get(`${PREFIX}/presets`, asyncHandler(async (_req, res) => {
    const result = listPresets();
    res.json(result);
  }));

  // ── GET /presets/:category — Get preset details ───────────────────────

  app.get(`${PREFIX}/presets/:category`, asyncHandler(async (req, res) => {
    const result = getPreset(req.params.category);
    if (!result.ok) {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  }));

  // ── POST /from-preset — Create template from a preset ────────────────

  app.post(`${PREFIX}/from-preset`, asyncHandler(async (req, res) => {
    const { category, appName, dbDriver } = req.body || {};

    if (!category) {
      throw new ValidationError("category is required", { field: "category" });
    }

    const result = createFromPreset(category, { appName, dbDriver });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.status(201).json(result);
  }));

  // ── POST /templates — Create custom template ─────────────────────────

  app.post(`${PREFIX}/templates`, asyncHandler(async (req, res) => {
    const spec = req.body;

    if (!spec || !spec.config) {
      throw new ValidationError("Template spec with config is required", { field: "config" });
    }

    const result = createTemplate(spec);
    res.status(201).json(result);
  }));

  // ── GET /templates — List templates ───────────────────────────────────

  app.get(`${PREFIX}/templates`, asyncHandler(async (req, res) => {
    const filter = {
      status: req.query.status || undefined,
      category: req.query.category || undefined,
    };
    const result = listTemplates(filter);
    res.json(result);
  }));

  // ── GET /templates/:id — Get template details ────────────────────────

  app.get(`${PREFIX}/templates/:id`, asyncHandler(async (req, res) => {
    const result = getTemplate(req.params.id);
    if (!result.ok) {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  }));

  // ── PUT /templates/:id — Update template ──────────────────────────────

  app.put(`${PREFIX}/templates/:id`, asyncHandler(async (req, res) => {
    const result = updateTemplate(req.params.id, req.body || {});
    if (!result.ok) {
      res.status(result.error === "Template not found" ? 404 : 400).json(result);
      return;
    }
    res.json(result);
  }));

  // ── DELETE /templates/:id — Delete template ───────────────────────────

  app.delete(`${PREFIX}/templates/:id`, asyncHandler(async (req, res) => {
    const result = deleteTemplate(req.params.id);
    if (!result.ok) {
      res.status(result.error === "Template not found" ? 404 : 400).json(result);
      return;
    }
    res.json(result);
  }));

  // ── POST /templates/:id/generate — Generate full code ─────────────────

  app.post(`${PREFIX}/templates/:id/generate`, asyncHandler(async (req, res) => {
    const result = generateTemplate(req.params.id);
    if (!result.ok) {
      res.status(result.error === "Template not found" ? 404 : 500).json(result);
      return;
    }
    res.status(201).json(result);
  }));

  // ── GET /templates/:id/preview/:section — Preview a single section ────

  app.get(`${PREFIX}/templates/:id/preview/:section`, asyncHandler(async (req, res) => {
    const result = previewSection(req.params.id, req.params.section);
    if (!result.ok) {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  }));

  // ── POST /templates/:id/publish — Publish as marketplace DTU ──────────

  app.post(`${PREFIX}/templates/:id/publish`, asyncHandler(async (req, res) => {
    const result = publishTemplate(req.params.id);
    if (!result.ok) {
      res.status(result.error === "Template not found" ? 404 : 400).json(result);
      return;
    }
    res.status(201).json(result);
  }));
}
