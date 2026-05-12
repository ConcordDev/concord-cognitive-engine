/**
 * Lens Developer Kit (LDK) Routes
 *
 * REST API for lens creation, validation, linting, and publishing.
 * Mounted at /api/ldk
 *
 * Endpoints:
 *   POST /api/ldk/generate    — generate lens template from config
 *   POST /api/ldk/validate    — validate a lens handler
 *   POST /api/ldk/lint        — lint a lens for quality
 *   POST /api/ldk/publish     — publish a new lens
 *   GET  /api/ldk/templates   — list available lens templates
 *   GET  /api/ldk/docs        — lens development documentation
 */

import { Router } from "express";
import {
  generateLensTemplate,
  validateLens,
  lintLens,
  publishLens,
  loadTemplates,
  clearTemplateCache,
} from "../lib/lens-developer-kit.js";
import { registerUserLens } from "../lib/lens-manifest.js";

/**
 * Create the LDK router.
 *
 * @param {object} deps
 * @param {string[]} deps.ALL_LENS_DOMAINS   — Live reference to the domain array
 * @param {Function} deps.registerLensAction  — Server's registerLensAction function
 * @returns {import('express').Router}
 */
export default function createLDKRouter(deps = {}) {
  const router = Router();

  // ── POST /api/ldk/generate — generate lens template from config ───────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/generate", async (req, res) => {
    try {
      const config = req.body || {};
      if (!config.domain) {
        return res.status(400).json({ ok: false, error: "config.domain is required." });
      }

      const result = await generateLensTemplate(config);
      if (!result.ok) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /api/ldk/validate — validate a lens handler ─────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/validate", (req, res) => {
    try {
      const { handler } = req.body || {};
      if (!handler) {
        return res.status(400).json({ ok: false, error: "Provide 'handler' — the handler module or source code to validate." });
      }

      // If handler is a string (source code), we attempt a lightweight structural check.
      // Full module validation requires the code to be loaded as a module — we do lint instead.
      if (typeof handler === "string") {
        // We can still do structural validation by checking for required patterns
        const hasDefaultExport = /export\s+default\s+function/.test(handler);
        const hasRegisterCalls = /registerLensAction\s*\(/.test(handler);
        const actionMatches = handler.match(/registerLensAction\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g) || [];

        const actions = actionMatches.map(m => {
          const parts = m.match(/registerLensAction\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/);
          return parts ? { domain: parts[1], action: parts[2] } : null;
        }).filter(Boolean);

        const errors = [];
        const warnings = [];

        if (!hasDefaultExport) errors.push("Missing 'export default function' — domain handlers must use a default export.");
        if (!hasRegisterCalls) errors.push("No registerLensAction() calls found — handler must register at least one action.");
        if (actions.length === 0 && hasRegisterCalls) warnings.push("Could not statically parse action registrations — verify manually.");

        const domains = [...new Set(actions.map(a => a.domain))];
        if (domains.length > 1) {
          warnings.push(`Handler registers actions across ${domains.length} domains: ${domains.join(", ")}. Typically a handler targets a single domain.`);
        }

        return res.json({
          ok: errors.length === 0,
          errors,
          warnings,
          info: {
            actionsRegistered: actions.length,
            domains,
            actionNames: actions.map(a => `${a.domain}.${a.action}`),
          },
        });
      }

      // If handler is an object/function (unlikely via JSON, but for completeness)
      const result = validateLens(handler);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /api/ldk/lint — lint a lens for quality ──────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/lint", (req, res) => {
    try {
      const { code } = req.body || {};
      if (!code || typeof code !== "string") {
        return res.status(400).json({ ok: false, error: "Provide 'code' — the handler source code to lint." });
      }

      const result = lintLens(code);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /api/ldk/publish — publish a new lens ───────────────────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/publish", async (req, res) => {
    try {
      const lensData = req.body || {};
      if (!lensData.domain) {
        return res.status(400).json({ ok: false, error: "lensData.domain is required." });
      }
      if (!lensData.handler) {
        return res.status(400).json({ ok: false, error: "lensData.handler (source code) is required." });
      }

      // Write the handler file and get the manifest
      const result = publishLens(lensData);
      if (!result.ok) {
        return res.status(400).json(result);
      }

      // Register the lens manifest in the live system
      if (result.manifest) {
        registerUserLens(result.manifest);
      }

      // If the caller provided ALL_LENS_DOMAINS reference, push the new domain
      if (deps.ALL_LENS_DOMAINS && !deps.ALL_LENS_DOMAINS.includes(result.domain)) {
        deps.ALL_LENS_DOMAINS.push(result.domain);
      }

      // Attempt to dynamically load and register the handler
      let dynamicLoad = false;
      if (deps.registerLensAction && result.handlerPath) {
        try {
          const mod = await import(result.handlerPath);
          const registerFn = mod.default || mod;
          if (typeof registerFn === "function") {
            registerFn(deps.registerLensAction);
            dynamicLoad = true;
          }
        } catch {
          // Handler was written but could not be hot-loaded — requires restart
        }
      }

      res.json({
        ...result,
        registered: true,
        hotLoaded: dynamicLoad,
        message: dynamicLoad
          ? `Lens "${result.domain}" published and live — no restart required.`
          : `Lens "${result.domain}" published. Restart the server to activate domain actions.`,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /api/ldk/templates — list available lens templates ────────────────
  router.get("/templates", async (_req, res) => {
    try {
      const templates = await loadTemplates();
      const list = [];
      for (const [id, tmpl] of templates) {
        list.push({
          id,
          name: tmpl.name,
          description: tmpl.description,
          category: tmpl.category,
          tags: tmpl.tags,
        });
      }

      res.json({
        ok: true,
        templates: list,
        count: list.length,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /api/ldk/docs — lens development documentation ───────────────────
  router.get("/docs", (_req, res) => {
    res.json({
      ok: true,
      title: "Lens Developer Kit (LDK) Documentation",
      version: "1.0.0",
      overview: "The LDK provides tools to create, validate, lint, and publish custom lenses for the Concord cognitive architecture.",
      architecture: {
        domainHandler: {
          description: "A domain handler is a JavaScript module that registers lens actions. It exports a default function that receives registerLensAction as its argument.",
          pattern: `export default function registerMyLensActions(registerLensAction) {\n  registerLensAction("my-lens", "myAction", (ctx, artifact, params) => {\n    // Action logic here\n    return { ok: true, result: { ... } };\n  });\n}`,
          requirements: [
            "Must use 'export default function'",
            "Function receives registerLensAction(domain, actionName, handler) as first argument",
            "Each action handler receives (ctx, artifact, params) and returns { ok, result } or { ok: false, error }",
            "Handler file goes in server/domains/<domain>.js",
          ],
        },
        frontendPage: {
          description: "Each lens can have a frontend page at app/lenses/<domain>/page.tsx using Next.js.",
          pattern: "Use 'use client' directive. Call /api/lens/<domain>/action to invoke actions.",
        },
        actionSignature: {
          ctx: "Request context with userId, sessionId, etc.",
          artifact: "The lens artifact — artifact.data holds the working data.",
          params: "Action parameters from the request body.",
          returns: "{ ok: true, result: {...} } on success, { ok: false, error: '...' } on failure.",
        },
      },
      endpoints: {
        "POST /api/ldk/generate": {
          description: "Generate a lens from a template.",
          body: {
            domain: "(required) Lens domain ID, e.g. 'inventory'",
            template: "(optional) Template ID: 'basic-crud', 'visualization', 'marketplace'. Default: 'basic-crud'",
            entityName: "(optional) Entity name for the lens, e.g. 'Product'",
            fields: "(optional) Array of field names for CRUD templates",
            options: "(optional) Template-specific options",
          },
          returns: "{ ok, handler, page, template, domain }",
        },
        "POST /api/ldk/validate": {
          description: "Validate a handler's structure.",
          body: { handler: "Handler source code as a string" },
          returns: "{ ok, errors, warnings, info: { actionsRegistered, domains, actionNames } }",
        },
        "POST /api/ldk/lint": {
          description: "Lint handler code for quality issues.",
          body: { code: "Handler source code as a string" },
          returns: "{ ok, issues, score, summary }",
        },
        "POST /api/ldk/publish": {
          description: "Publish a new lens to the system.",
          body: {
            domain: "(required) Lens domain ID",
            handler: "(required) Handler source code",
            page: "(optional) Frontend page source code",
            description: "(optional) Human description",
            tags: "(optional) Domain tags for routing",
            category: "(optional) Lens category",
          },
          returns: "{ ok, domain, handlerPath, pagePath, lint, manifest, registered, hotLoaded }",
        },
        "GET /api/ldk/templates": {
          description: "List all available lens templates.",
          returns: "{ ok, templates, count }",
        },
        "GET /api/ldk/docs": {
          description: "This documentation endpoint.",
        },
      },
      templates: {
        "basic-crud": "Entity CRUD: create, read, update, delete, list, search. Best for data management lenses.",
        "visualization": "Data viz: chart config, dataset transforms, insight extraction, dashboard composition. Best for analytics lenses.",
        "marketplace": "Commerce: listings, search, purchase, reviews, seller analytics. Best for marketplace/store lenses.",
      },
      bestPractices: [
        "Always return { ok: true, result: {...} } or { ok: false, error: '...' } from action handlers.",
        "Validate required fields early and return clear error messages.",
        "Keep action handlers pure — avoid side effects beyond artifact.data mutations.",
        "Use descriptive action names that map to the 8 universal action types: QUERY, ANALYZE, CREATE, SIMULATE, TRADE, CONNECT, TEACH, MANAGE.",
        "Add JSDoc comments above each registerLensAction call documenting expected artifact.data shape and params.",
        "Run lintLens() before publishing to catch stubs, TODOs, and quality issues.",
        "Test with the /api/lens/run endpoint: POST { domain, action, ...params }.",
      ],
    });
  });

  return router;
}
