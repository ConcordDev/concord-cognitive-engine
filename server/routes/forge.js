/**
 * Forge Routes — Polyglot Monolith Template Engine API
 *
 * Endpoints for generating, validating, and exporting Forge app templates.
 * Integrated as a mode within the Code lens.
 *
 * Routes:
 *   GET  /api/forge/templates         — List available base templates
 *   GET  /api/forge/templates/:id     — Get template details with sections
 *   POST /api/forge/generate          — Generate a Forge app from config
 *   POST /api/forge/validate          — Validate a config before generation
 *   GET  /api/forge/sections          — List all 13 sections with metadata
 *   GET  /api/forge/constants         — Get Forge system constants
 *   POST /api/forge/export            — Export generated app (download)
 *   GET  /api/forge/repair-log        — Get repair cortex event log
 *   POST /api/forge/check-avoidance   — Check code against avoidance patterns
 */

import { Router } from "express";
import {
  generateForgeApp,
  validateForgeConfig,
  getForgeTemplateSections,
  listForgeTemplates,
} from "../lib/forge-template-generator.js";
import {
  FORGE_SECTIONS,
  FORGE_DEFAULT_CONFIG,
  FORGE_TEMPLATES,
  THREAD_MANAGER,
  REPAIR_CORTEX,
  POLYGLOT_BRIDGE,
  FORGE_MARKETPLACE,
} from "../lib/forge-constants.js";

export default function createForgeRouter({ db }) {
  const router = Router();

  // ── List available base templates ─────────────────────────────────
  router.get("/templates", (_req, res) => {
    const templates = listForgeTemplates();
    res.json({
      ok: true,
      templates,
      count: templates.length,
    });
  });

  // ── Get template details with sections ────────────────────────────
  router.get("/templates/:id", (req, res) => {
    const template = FORGE_TEMPLATES[req.params.id];
    if (!template) {
      return res.status(404).json({ ok: false, error: "Template not found" });
    }
    const sections = getForgeTemplateSections(req.params.id);
    res.json({
      ok: true,
      template,
      sections,
      defaultConfig: FORGE_DEFAULT_CONFIG,
    });
  });

  // ── Generate a Forge app ──────────────────────────────────────────
  router.post("/generate", (req, res) => {
    try {
      const {
        templateId = "blank",
        config = {},
        domainTables = [],
        enabledSections = null,
      } = req.body;

      const result = generateForgeApp({
        templateId,
        config,
        domainTables,
        enabledSections,
      });

      // Persist generation event
      try {
        if (db) {
          const stmt = db.prepare(`
            INSERT INTO forge_generations (template_id, config, app_name, lines, sections_count, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
          `);
          stmt.run(
            templateId,
            JSON.stringify(config),
            result.config.appName,
            result.stats.linesEstimate,
            result.stats.totalSections
          );
        }
      } catch {
        // Table may not exist yet — non-fatal
      }

      res.json({
        ok: true,
        code: result.code,
        sections: result.sections,
        config: result.config,
        template: result.template,
        stats: result.stats,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Validate config ───────────────────────────────────────────────
  router.post("/validate", (req, res) => {
    const { config = {} } = req.body;
    const merged = {
      ...JSON.parse(JSON.stringify(FORGE_DEFAULT_CONFIG)),
      ...config,
    };
    const result = validateForgeConfig(merged);
    res.json({ ok: true, ...result, config: merged });
  });

  // ── List all 13 sections ──────────────────────────────────────────
  router.get("/sections", (_req, res) => {
    res.json({
      ok: true,
      sections: FORGE_SECTIONS,
      count: FORGE_SECTIONS.length,
      repairCortex: {
        note: "Section 13 (Repair Cortex) cannot be disabled. Every app heals itself.",
        phases: REPAIR_CORTEX.PHASES,
      },
    });
  });

  // ── Get system constants ──────────────────────────────────────────
  router.get("/constants", (_req, res) => {
    res.json({
      ok: true,
      sections: FORGE_SECTIONS,
      defaultConfig: FORGE_DEFAULT_CONFIG,
      threadManager: THREAD_MANAGER,
      repairCortex: REPAIR_CORTEX,
      polyglotBridge: POLYGLOT_BRIDGE,
      marketplace: FORGE_MARKETPLACE,
      templates: FORGE_TEMPLATES,
    });
  });

  // ── Export generated app as downloadable file ─────────────────────
  router.post("/export", (req, res) => {
    try {
      const result = generateForgeApp(req.body);
      const filename = `${result.config.appName || "forge-app"}.mjs`;

      res.setHeader("Content-Type", "application/javascript");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(result.code);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Check code against avoidance patterns ─────────────────────────
  router.post("/check-avoidance", (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ ok: false, error: "code is required" });

    // Basic avoidance pattern checks
    const violations = [];
    const patterns = [
      { pattern: /eval\s*\(/, description: "eval() usage detected — security risk", severity: "critical" },
      { pattern: /SELECT\s+\*\s+FROM/i, description: "SELECT * query — specify columns explicitly for performance", severity: "medium" },
      { pattern: /\.env/, description: "Direct .env reference — use CONFIG object instead", severity: "low" },
      { pattern: /process\.exit\(0\)/, description: "Hard exit — use graceful shutdown instead", severity: "medium" },
      { pattern: /setTimeout.*0\)/, description: "setTimeout(fn, 0) — consider setImmediate or proper async", severity: "low" },
    ];

    for (const p of patterns) {
      if (p.pattern.test(code)) {
        violations.push({ description: p.description, severity: p.severity });
      }
    }

    res.json({
      ok: true,
      violations,
      clean: violations.length === 0,
      checkedPatterns: patterns.length,
    });
  });

  // ── Ensure forge_generations table exists ─────────────────────────
  try {
    if (db) {
      db.exec(`CREATE TABLE IF NOT EXISTS forge_generations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id TEXT NOT NULL,
        config JSON,
        app_name TEXT,
        lines INTEGER,
        sections_count INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
    }
  } catch {
    // Non-fatal — table creation may fail in test environments
  }

  return router;
}
