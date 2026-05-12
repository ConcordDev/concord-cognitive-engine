/**
 * Codebase Inventory routes — queryable index of all components, lenses,
 * server libraries, and their wiring.
 *
 * Mounted at /api/inventory
 *
 * Endpoints:
 *   GET /api/inventory            — full inventory summary
 *   GET /api/inventory/components — all components with wiring status
 *   GET /api/inventory/lenses     — all lenses with their imports
 *   GET /api/inventory/orphans    — orphaned components
 *   GET /api/inventory/wiring     — full wiring map
 *   GET /api/inventory/search?q=  — search inventory
 */
import { Router } from "express";
import {
  scanFrontendComponents,
  scanServerLibraries,
  scanLensPages,
  findOrphans,
  buildWiringMap,
  searchInventory,
  getInventorySummary,
  clearCache,
} from "../lib/codebase-inventory.js";

/**
 * Create the inventory router.
 *
 * @returns {import('express').Router}
 */
export default function createInventoryRouter() {
  const router = Router();

  // ── GET /api/inventory — full inventory summary ───────────────────────
  router.get("/", (_req, res) => {
    try {
      const summary = getInventorySummary();
      res.json({ ok: true, ...summary });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /api/inventory/components — all components with wiring status ─
  router.get("/components", (_req, res) => {
    try {
      const components = scanFrontendComponents();
      const wiring = buildWiringMap();

      const enriched = components.map((comp) => ({
        ...comp,
        usedByLenses: wiring.components[comp.path]?.usedByLenses || [],
        isOrphaned: (wiring.components[comp.path]?.usedByLenses || []).length === 0,
      }));

      res.json({ ok: true, count: enriched.length, components: enriched });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /api/inventory/lenses — all lenses with their imports ─────────
  router.get("/lenses", (_req, res) => {
    try {
      const lenses = scanLensPages();
      const wiring = buildWiringMap();

      const enriched = lenses.map((lens) => ({
        ...lens,
        components: wiring.lenses[lens.name]?.components || [],
        serverRoutes: wiring.lenses[lens.name]?.serverRoutes || [],
      }));

      res.json({ ok: true, count: enriched.length, lenses: enriched });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /api/inventory/orphans — orphaned components ──────────────────
  router.get("/orphans", (_req, res) => {
    try {
      const orphans = findOrphans();
      res.json({ ok: true, count: orphans.length, orphans });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /api/inventory/wiring — full wiring map ───────────────────────
  router.get("/wiring", (_req, res) => {
    try {
      const wiring = buildWiringMap();
      res.json({ ok: true, ...wiring });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /api/inventory/search?q=... — search inventory ────────────────
  router.get("/search", (req, res) => {
    try {
      const q = req.query.q || "";
      if (!q.trim()) {
        return res.status(400).json({ ok: false, error: "Missing ?q= query parameter" });
      }
      const results = searchInventory(q);
      res.json({ ok: true, query: q, count: results.length, results });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /api/inventory/refresh — bust cache and re-scan ──────────────
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/refresh", (_req, res) => {
    try {
      clearCache();
      const summary = getInventorySummary();
      res.json({ ok: true, message: "Cache cleared, inventory re-scanned.", ...summary });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  return router;
}
