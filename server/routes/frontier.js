/**
 * Frontier Features API Routes — Unified Router
 *
 * Combines all 16 frontier feature modules into a single router
 * mounted at /api/frontier. Each part handles a subset of features:
 *
 *   Part 1: Fabrication, Sensors, Blockchain, Shell        (15 routes)
 *   Part 2: Notebook, Marketplace, Certificates, Federation (20 routes)
 *   Part 4: Agents, Standards, DTU Diff, Dependency Graph  (13 routes)
 *
 * Part 3 (DSL Compiler, Digital Twins, Voice, Replay) was removed
 * 2026-07-04 — it was entirely fabricated data (Math.random telemetry,
 * canned findings, a hardcoded fake voice transcript, a fake DSL
 * "compiler") with zero consumers. Real equivalents live in
 * domains/digital-twin.js and the event_timeline domain.
 *
 * Total: 48 routes across 12 frontier features
 */

import { Router } from 'express';
import { createRequire } from 'module';
import createFrontierRoutesPart1 from './frontier-part1.js';
import createFrontierRoutesPart2 from './frontier-part2.js';
import createFrontierRoutesPart4 from './frontier-part4.js';
// frontier-part3.js was removed (2026-07-04) — every route in it fabricated
// data (Math.random sensor telemetry, canned "assessment" findings, a
// hardcoded fake voice transcript, random forensic event counts, a fake DSL
// "compiler") and had zero consumers repo-wide. This unified router (frontier.js
// itself) also has zero consumers — it is never imported by server.js, which
// mounts part1/part2/part4 directly instead.

// Load CommonJS frontier config via createRequire (config is CJS)
const require = createRequire(import.meta.url);
const frontierConfig = require('../config/frontier.cjs');

/**
 * @param {object} [opts]
 * @param {Function} [opts.requireAuth] - Auth middleware
 * @returns {Router}
 */
export default function createFrontierRoutes({ requireAuth } = {}) {
  const router = Router();

  // Expose frontier config to all route handlers via req.frontierConfig
  router.use((_req, _res, next) => {
    _req.frontierConfig = frontierConfig;
    next();
  });

  // Mount each feature group
  router.use('/', createFrontierRoutesPart1({ requireAuth }));
  router.use('/', createFrontierRoutesPart2({ requireAuth }));
  router.use('/', createFrontierRoutesPart4({ requireAuth }));

  // ── Health & Discovery ──────────────────────────────────────────────────

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'frontier',
      features: [
        'fabrication', 'sensors', 'blockchain', 'shell',
        'notebooks', 'marketplace', 'certificates', 'federation',
        'agents', 'standards', 'dtu-diff', 'dependency-graph',
      ],
      featureCount: 12,
      status: 'operational',
      uptime: process.uptime(),
    });
  });

  // Expose frontier feature configuration
  router.get('/config', (_req, res) => {
    res.json({
      ok: true,
      config: frontierConfig,
      featureCount: Object.keys(frontierConfig).length,
    });
  });

  router.get('/routes', (_req, res) => {
    const routes = [];
    const extractRoutes = (stack, prefix = '') => {
      for (const layer of stack) {
        if (layer.route) {
          const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
          routes.push({ methods, path: prefix + layer.route.path });
        } else if (layer.name === 'router' && layer.handle?.stack) {
          extractRoutes(layer.handle.stack, prefix + (layer.regexp?.source === '^\\/?$' ? '' : ''));
        }
      }
    };
    extractRoutes(router.stack);
    res.json({ ok: true, routes, count: routes.length });
  });

  return router;
}
