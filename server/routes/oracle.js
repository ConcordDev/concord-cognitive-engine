/**
 * Oracle Engine Routes
 *
 * REST API for the Oracle Engine — the multi-phase reasoning pipeline that
 * handles complex, multi-domain, and research-grade queries. The Oracle sits
 * above the standard brain and orchestrates lens handlers, DTU retrieval,
 * computation, and citation.
 *
 * Endpoints:
 *   POST /api/oracle/solve    — full solve pipeline (phase 1..N)
 *   POST /api/oracle/analyze  — phase 1 only, for routing preview
 *   GET  /api/oracle/stats    — Oracle usage stats
 *   POST /api/oracle/recent   — recent oracle_answer DTUs
 *
 * Mounted at /api/oracle in server.js.
 */

import express from 'express';
import { createOracleEngine } from '../lib/oracle-engine.js';

export default function createOracleRoutes({ STATE, requireAuth, dtuStore, domainHandlers }) {
  const router = express.Router();

  // Lazy singleton — the Oracle Engine may not exist on first import
  // (parallel build), so defer instantiation until first request.
  let oracleInstance = null;
  const getOracle = () => {
    if (!oracleInstance) {
      oracleInstance = createOracleEngine({
        dtuStore: STATE.dtus || dtuStore,
        domainHandlers,
        entities: STATE.entities,
        db: STATE.db,
      });
    }
    return oracleInstance;
  };

  // POST /api/oracle/solve — main solve endpoint
  router.post('/solve', requireAuth, async (req, res) => {
    try {
      const { query, context = {} } = req.body;
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ ok: false, error: 'query required' });
      }
      const oracle = getOracle();
      const result = await oracle.solve(query, { ...context, userId: req.user?.id });
      res.json({ ok: true, result });
    } catch (e) {
      console.error('[oracle] solve error:', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/oracle/analyze — just phase 1 (for routing preview)
  router.post('/analyze', requireAuth, async (req, res) => {
    try {
      const { query } = req.body;
      const oracle = getOracle();
      const analysis = await oracle.analyze(query);
      res.json({ ok: true, analysis });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/oracle/stats — Oracle usage stats
  router.get('/stats', requireAuth, async (req, res) => {
    try {
      const oracle = getOracle();
      const stats = oracle.getStats ? oracle.getStats() : {
        queriesResolved: 0, avgConfidence: 0, totalDTUsCreated: 0,
      };
      res.json({ ok: true, stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/oracle/recent — recent oracle answers (read-only listing)
  router.get('/recent', requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query?.limit) || 10, 50);
      const dtus = STATE.dtus?.list ? STATE.dtus.list({ type: 'oracle_answer', limit }) : [];
      res.json({ ok: true, items: dtus });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
