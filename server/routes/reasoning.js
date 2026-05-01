/**
 * server/routes/reasoning.js
 *
 * REST API for reasoning session transparency.
 * Allows the frontend to poll active reasoning sessions and display depth indicators.
 */

import { Router } from 'express';
import { getReasoningSession, listReasoningSessions } from '../lib/reasoning/ongoing-shadow.js';
import { executeReasoningWithCrystallization } from '../lib/reasoning/continuation.js';

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

  // POST /api/reasoning/execute — run a task with crystallization support
  // Body: { intent, brainRole?, modelName?, maxSteps? }
  // Returns immediately with { ok, sessionId } while reasoning runs async,
  // or { ok, finalText, reasoningSessionId?, shadowCount } when complete.
  router.post('/execute', async (req, res) => {
    const { intent, brainRole = 'conscious', modelName, maxSteps = 10 } = req.body || {};
    if (!intent || typeof intent !== 'string') {
      return res.status(400).json({ ok: false, error: 'intent is required' });
    }

    try {
      // Minimal stub — full wiring requires selectBrain from server.js context.
      // When called from the sovereign/agent dispatch, brain + inferFn are injected.
      const brain = STATE?.BRAIN?.[brainRole] || STATE?.brains?.[brainRole];
      const inferFn = STATE?.infer;

      if (!brain || !inferFn) {
        return res.status(503).json({ ok: false, error: 'Brain not available for standalone reasoning' });
      }

      const result = await executeReasoningWithCrystallization({
        intent,
        brain,
        messages: [{ role: 'user', content: intent }],
        inferFn,
        commitShadowDTU: async (_dtu) => ({ ok: true }),
        userId: req.user?.id,
        callerId: `reasoning:route:${req.user?.id || 'anon'}`,
        brainRole,
        modelName,
        maxSteps: Math.min(maxSteps, 20),
      });

      res.json({
        ok: true,
        finalText: result.finalText,
        reasoningSessionId: result.reasoningSessionId,
        shadowCount: result.shadowCount,
        wasSynthesized: result.wasSynthesized,
        crystallizations: result.crystallizations,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || 'Reasoning execution failed' });
    }
  });

  return router;
}
