/**
 * Compute Routes — Unified compute layer REST API
 *
 * Exposes the compute-registry (server/lib/compute-registry.js) over HTTP so
 * the frontend, Oracle Engine Phase 3, and external callers can:
 *
 *   GET  /api/compute/catalog   — list all capabilities (optionally grouped)
 *   POST /api/compute/match     — score a query against the catalog
 *   POST /api/compute/execute   — run one capability with input data
 *   POST /api/compute/batch     — run many capabilities in parallel
 *   POST /api/compute/resolve   — match-then-execute in a single call
 *   GET  /api/compute/summary   — per-domain capability counts
 *
 * Mounted at /api/compute in server.js.
 */

import express from 'express';
import {
  COMPUTE_CAPABILITIES,
  matchCapabilities,
  executeCompute,
  executeBatch,
  resolveAndExecute,
  getCatalog,
  getCatalogByDomain,
  getDomainSummary,
} from '../lib/compute-registry.js';
import { listComputeModules, loadComputeModule } from '../lib/compute/index.js';
import { asyncHandler } from '../lib/async-handler.js';

export default function createComputeRoutes({ requireAuth, domainHandlers } = {}) {
  const router = express.Router();
  const auth = typeof requireAuth === 'function'
    ? requireAuth
    : (_req, _res, next) => next();

  // GET /api/compute/catalog — list all capabilities
  router.get('/catalog', auth, (req, res) => {
    try {
      const grouped = String(req.query.grouped || '') === '1'
        || String(req.query.grouped || '') === 'true';
      const catalog = grouped ? getCatalogByDomain() : getCatalog();
      res.json({
        ok: true,
        total: Object.keys(COMPUTE_CAPABILITIES).length,
        grouped,
        catalog,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/compute/summary — per-domain counts
  router.get('/summary', auth, (_req, res) => {
    try {
      res.json({ ok: true, summary: getDomainSummary() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/compute/match — match a query to capabilities
  // body: { query, threshold?, limit? }
  router.post('/match', auth, (req, res) => {
    try {
      const { query, threshold, limit } = req.body || {};
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ ok: false, error: 'query (string) required' });
      }
      const matches = matchCapabilities(query, {
        threshold: typeof threshold === 'number' ? threshold : 0.1,
        limit: typeof limit === 'number' ? Math.min(Math.max(limit, 1), 50) : 5,
      });
      res.json({ ok: true, query, matchCount: matches.length, matches });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/compute/execute — execute a single capability
  // body: { key, input, timeoutMs? }
  router.post('/execute', auth, async (req, res) => {
    try {
      const { key, input, timeoutMs } = req.body || {};
      if (!key || typeof key !== 'string') {
        return res.status(400).json({ ok: false, error: 'key (string) required' });
      }
      if (!COMPUTE_CAPABILITIES[key]) {
        return res.status(404).json({ ok: false, error: `Unknown capability: ${key}` });
      }
      const out = await executeCompute(key, input || {}, {
        domainHandlers,
        ctx: { userId: req.user?.id, role: req.user?.role },
        timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : 30_000,
      });
      if (!out.ok) return res.status(200).json({ ok: false, ...out });
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/compute/batch — run many capabilities in parallel
  // body: { keys: string[], input, timeoutMs? }
  router.post('/batch', auth, async (req, res) => {
    try {
      const { keys, input, timeoutMs } = req.body || {};
      if (!Array.isArray(keys) || keys.length === 0) {
        return res.status(400).json({ ok: false, error: 'keys (non-empty array) required' });
      }
      if (keys.length > 25) {
        return res.status(400).json({ ok: false, error: 'batch too large (max 25 keys)' });
      }
      const unknown = keys.filter(k => !COMPUTE_CAPABILITIES[k]);
      if (unknown.length > 0) {
        return res.status(400).json({
          ok: false,
          error: `Unknown capabilities: ${unknown.join(', ')}`,
        });
      }
      const out = await executeBatch(keys, input || {}, {
        domainHandlers,
        ctx: { userId: req.user?.id, role: req.user?.role },
        timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : 30_000,
      });
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/compute/resolve — match + execute in one call
  // body: { query, input, limit?, threshold?, timeoutMs? }
  router.post('/resolve', auth, async (req, res) => {
    try {
      const { query, input, limit, threshold, timeoutMs } = req.body || {};
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ ok: false, error: 'query (string) required' });
      }
      const out = await resolveAndExecute(query, input || {}, {
        domainHandlers,
        ctx: { userId: req.user?.id, role: req.user?.role },
        limit: typeof limit === 'number' ? Math.min(Math.max(limit, 1), 10) : 3,
        threshold: typeof threshold === 'number' ? threshold : 0.1,
        timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : 30_000,
      });
      res.json({ ok: true, query, ...out });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/compute/modules — list primitive compute modules
  router.get('/modules', asyncHandler(async (req, res) => {
    const modules = listComputeModules();
    res.json({ ok: true, modules });
  }));

  // POST /api/compute/run — call a function in a primitive compute module
  router.post('/run', asyncHandler(async (req, res) => {
    const { module: moduleName, fn, args = [] } = req.body;
    const mod = await loadComputeModule(moduleName);
    if (!mod) return res.status(404).json({ ok: false, error: `Unknown compute module: ${moduleName}` });
    if (typeof mod[fn] !== 'function') return res.status(400).json({ ok: false, error: `Unknown function: ${fn}` });
    const result = mod[fn](...args);
    res.json({ ok: true, result });
  }));

  return router;
}
