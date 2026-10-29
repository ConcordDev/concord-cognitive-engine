/**
 * server/routes/reasoning.js
 *
 * REST API for reasoning session transparency.
 * Allows the frontend to poll active reasoning sessions and display depth indicators.
 */

import { Router } from 'express';
import { getReasoningSession, listReasoningSessions } from '../lib/reasoning/ongoing-shadow.js';
import { executeReasoningWithCrystallization } from '../lib/reasoning/continuation.js';
import { selectBrain } from '../lib/inference/router.js';
import { infer } from '../lib/inference/index.js';

/**
 * @param {{ STATE: object, selectBrain?: Function, infer?: Function }} deps
 *   selectBrain/infer are injectable for tests; production uses the real
 *   inference stack (the same selectBrain + infer that serve chat).
 * @returns {Router}
 */
export function createReasoningRouter({ STATE, selectBrain: selectBrainDep = selectBrain, infer: inferDep = infer } = {}) {
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

    const callerId = `reasoning:route:${req.user?.id || 'anon'}`;

    try {
      // Brain + infer resolution (Q30): injected wiring wins — the
      // sovereign/agent dispatch can still supply its own brain handle
      // and infer function via STATE. Otherwise select for real:
      // previously this route ONLY worked when a caller injected
      // STATE.BRAIN / STATE.infer, which no production registration
      // does (server.js passes just { STATE }), so /execute 503'd for
      // every real request. selectBrain returns the handle runAgentLoop
      // consumes (handle.chat), and lib/inference's infer(req, db)
      // matches the crystallizer's inferFn contract exactly
      // ({ role, intent, history, callerId } -> { finalText }); its db
      // use is fail-safe, so STATE?.db may be undefined.
      let brain = STATE?.BRAIN?.[brainRole] || STATE?.brains?.[brainRole];
      if (!brain) {
        ({ handle: brain } = await selectBrainDep(brainRole, { callerId }));
      }
      const inferFn = STATE?.infer || ((r) => inferDep(r, STATE?.db));

      const result = await executeReasoningWithCrystallization({
        intent,
        brain,
        messages: [{ role: 'user', content: intent }],
        inferFn,
        commitShadowDTU: async (_dtu) => ({ ok: true }),
        userId: req.user?.id,
        callerId,
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
      // selectBrain throws this when the (conscious) brain is genuinely
      // down — that's an availability answer (503), not a server fault.
      if (err?.code === 'conscious_brain_unavailable') {
        return res.status(503).json({ ok: false, error: err.message, code: err.code });
      }
      res.status(500).json({ ok: false, error: err?.message || 'Reasoning execution failed' });
    }
  });

  return router;
}
