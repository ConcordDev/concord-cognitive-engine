/**
 * server/routes/reasoning.js
 *
 * REST API for reasoning session transparency.
 * Allows the frontend to poll active reasoning sessions and display depth indicators.
 */

import { Router } from 'express';
import { getReasoningSession, listReasoningSessions } from '../lib/reasoning/ongoing-shadow.js';

/**
 * @param {{ STATE: object }} deps
 * @returns {Router}
 */
export function createReasoningRouter({ STATE } = {}) {
  const router = Router();

  // GET /api/reasoning/sessions — list recent reasoning sessions
  router.get('/sessions', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const sessions = listReasoningSessions(limit);
    res.json({ ok: true, sessions, total: sessions.length });
  });

  // GET /api/reasoning/session/:id — get a specific session (for UI polling)
  router.get('/session/:id', (req, res) => {
    const session = getReasoningSession(req.params.id);
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }

    // Only return session owned by the requesting user (or no user for anonymous)
    if (session.userId && req.user?.id && session.userId !== req.user.id) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    res.json({ ok: true, session });
  });

  // GET /api/reasoning/session/:id/full — full session detail with shadow DTUs
  router.get('/session/:id/full', (req, res) => {
    const session = getReasoningSession(req.params.id);
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }

    // Retrieve shadow DTUs from STATE
    const shadows = [];
    if (STATE?.shadowDtus) {
      for (const dtu of STATE.shadowDtus.values()) {
        if (dtu.ongoing_reasoning_session === req.params.id || dtu.machine?.sessionId === req.params.id) {
          shadows.push({
            id: dtu.id,
            generation: dtu.shadow_generation || dtu.machine?.generation,
            summary: dtu.human?.summary,
            insights: dtu.core?.invariants || dtu.human?.bullets || [],
            createdAt: dtu.created_at,
          });
        }
      }
      shadows.sort((a, b) => (a.generation || 0) - (b.generation || 0));
    }

    res.json({
      ok: true,
      session,
      shadows,
      shadowCount: shadows.length,
    });
  });

  return router;
}
