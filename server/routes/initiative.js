/**
 * Initiative Routes — Conversational Initiative (Living Chat)
 *
 * REST API surface for managing Concord's proactive outreach system.
 * Handles settings, pending/history views, trigger evaluation, status
 * transitions (dismiss/read/respond), style learning, double-text,
 * and aggregate statistics.
 *
 * Route prefix: /api/initiative
 *
 * Routes:
 *   GET  /api/initiative/settings       — Get user's initiative settings
 *   PUT  /api/initiative/settings       — Update settings
 *   GET  /api/initiative/pending        — Get pending initiatives for current user
 *   GET  /api/initiative/history        — Get initiative history (paginated)
 *   POST /api/initiative/trigger        — Manually trigger an initiative evaluation
 *   POST /api/initiative/:id/dismiss    — Dismiss an initiative
 *   POST /api/initiative/:id/read       — Mark as read
 *   POST /api/initiative/:id/respond    — Mark as responded
 *   GET  /api/initiative/style          — Get user's style profile
 *   POST /api/initiative/style/learn    — Submit a message for style learning
 *   GET  /api/initiative/stats          — Overall initiative stats
 *   POST /api/initiative/double-text    — Generate a double text
 */

import { asyncHandler } from "../lib/async-handler.js";
import { createInitiativeEngine } from "../lib/initiative-engine.js";

/**
 * Extract userId from the request using multiple fallbacks.
 * @param {import('express').Request} req
 * @returns {string}
 */
function _getUserId(req) {
  return req.user?.id || "anonymous";
}

/**
 * Register initiative routes on the Express app.
 *
 * @param {import('express').Express} app - Express application
 * @param {object} deps - Dependencies from server wiring
 * @param {import('better-sqlite3').Database} deps.db - SQLite database
 * @param {Function} [deps.requireAuth] - Auth middleware
 * @param {Function} [deps.realtimeEmit] - WebSocket broadcast function (optional)
 */
export default function registerInitiativeRoutes(app, deps) {
  const { db } = deps;
  const _auth = typeof deps.requireAuth === "function" ? deps.requireAuth : (_r, _s, n) => n();
  const engine = createInitiativeEngine(db);

  // Expose engine for external callers (e.g., proactive tick in server.js)
  app._initiativeEngine = engine;

  // ── GET /api/initiative/settings ─────────────────────────────────────
  // Get user's initiative settings (creates defaults if not present)

  app.get("/api/initiative/settings", _auth, asyncHandler(async (req, res) => {
    const userId = _getUserId(req);
    const settings = engine.getSettings(userId);
    const backoff = engine.getBackoff(userId);

    res.json({
      ok: true,
      settings,
      backoff,
      limits: {
        maxPerDay: settings.maxPerDay,
        maxPerWeek: settings.maxPerWeek,
        minGapMs: 4 * 60 * 60 * 1000,
      },
      availableTriggers: engine.TRIGGER_TYPES.map(t => {
        // Convert snake_case to camelCase for frontend trigger config lookup
        const id = t.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        return {
          id,
          label: t.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
          description: `Triggered by ${t.replace(/_/g, ' ')} events`,
          priority: t === 'world_event' ? 'high' : t === 'check_in' ? 'low' : 'normal',
        };
      }),
      availableChannels: engine.CHANNELS.map(c => ({
        id: c,
        label: c === 'inApp' ? 'In-App' : c === 'push' ? 'Push Notification' : c === 'sms' ? 'SMS' : 'Email',
        description: c === 'inApp' ? 'Messages appear in the chat rail'
          : c === 'push' ? 'Browser/mobile push notifications'
          : c === 'sms' ? 'Text messages to your phone'
          : 'Email notifications',
        requiresOptIn: c !== 'inApp',
      })),
    });
  }));

  // ── PUT /api/initiative/settings ─────────────────────────────────────
  // Update settings (partial merge)

  app.put("/api/initiative/settings", _auth, asyncHandler(async (req, res) => {
    const userId = _getUserId(req);
    const body = req.body || {};

    const updated = engine.updateSettings(userId, {
      maxPerDay: body.maxPerDay,
      maxPerWeek: body.maxPerWeek,
      quietStart: body.quietStart,
      quietEnd: body.quietEnd,
      allowDoubleText: body.allowDoubleText,
      channels: body.channels,
      disabled: body.disabled,
    });

    res.json({ ok: true, settings: updated });
  }));

  // ── GET /api/initiative/pending ──────────────────────────────────────
  // Get pending initiatives for the current user

  app.get("/api/initiative/pending", _auth, asyncHandler(async (req, res) => {
    const userId = _getUserId(req);
    const result = engine.getPending(userId);

    res.json({ ok: true, ...result });
  }));

  // ── GET /api/initiative/history ──────────────────────────────────────
  // Get initiative history with pagination { limit, offset, status? }

  app.get("/api/initiative/history", _auth, asyncHandler(async (req, res) => {
    const userId = _getUserId(req);
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const status = req.query.status || undefined;

    const result = engine.getHistory(userId, { limit, offset, status });

    res.json({ ok: true, ...result });
  }));

  // ── POST /api/initiative/trigger ─────────────────────────────────────
  // Manually trigger an initiative evaluation { triggerType, context }

  app.post("/api/initiative/trigger", _auth, asyncHandler(async (req, res) => {
    const userId = _getUserId(req);
    const { triggerType, context } = req.body || {};

    if (!triggerType) {
      return res.status(400).json({ ok: false, error: "triggerType is required" });
    }

    // Evaluate whether the trigger should fire
    const evaluation = engine.evaluateTrigger(userId, triggerType, context || {});

    // If it should fire, create the initiative
    let initiative = null;
    if (evaluation.shouldFire) {
      const message = (context && context.message)
        ? context.message
        : `Initiative triggered: ${triggerType}`;

      initiative = engine.createInitiative(userId, triggerType, message, {
        priority: evaluation.suggestedPriority || "normal",
        metadata: context || {},
      });

      // Broadcast via WebSocket so the frontend can display it in real time
      try {
        const emit = globalThis.realtimeEmit;
        if (typeof emit === "function") {
          emit("initiative:new", {
            id: initiative.id,
            triggerType: initiative.triggerType,
            message: initiative.message,
            priority: initiative.priority,
            score: initiative.score,
            status: initiative.status,
            channel: initiative.channel,
            metadata: initiative.metadata,
            createdAt: initiative.createdAt,
          });
        }
      } catch (_e) { /* best-effort broadcast */ }
    }

    res.json({
      ok: true,
      evaluation,
      initiative,
    });
  }));

  // ── POST /api/initiative/:id/dismiss ─────────────────────────────────
  // Dismiss an initiative

  app.post("/api/initiative/:id/dismiss", asyncHandler(async (req, res) => {
    const initiativeId = req.params.id;
    const result = engine.dismissInitiative(initiativeId);

    res.json({ ok: true, ...result });
  }));

  // ── POST /api/initiative/:id/read ────────────────────────────────────
  // Mark initiative as read

  app.post("/api/initiative/:id/read", asyncHandler(async (req, res) => {
    const initiativeId = req.params.id;
    const result = engine.markRead(initiativeId);

    res.json({ ok: true, ...result });
  }));

  // ── POST /api/initiative/:id/respond ─────────────────────────────────
  // Mark initiative as responded (user engaged)

  app.post("/api/initiative/:id/respond", asyncHandler(async (req, res) => {
    const initiativeId = req.params.id;
    const result = engine.markResponded(initiativeId);

    res.json({ ok: true, ...result });
  }));

  // ── GET /api/initiative/style ────────────────────────────────────────
  // Get user's learned style profile

  app.get("/api/initiative/style", _auth, asyncHandler(async (req, res) => {
    const userId = _getUserId(req);
    const profile = engine.getStyleProfile(userId);

    res.json({ ok: true, profile });
  }));

  // ── POST /api/initiative/style/learn ─────────────────────────────────
  // Submit a message for style learning { message }

  app.post("/api/initiative/style/learn", _auth, asyncHandler(async (req, res) => {
    const userId = _getUserId(req);
    const { message } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "message is required and must be a string" });
    }

    const profile = engine.learnStyle(userId, message);

    res.json({ ok: true, profile });
  }));

  // ── GET /api/initiative/stats ────────────────────────────────────────
  // Overall initiative stats

  app.get("/api/initiative/stats", asyncHandler(async (req, res) => {
    const stats = engine.getStats();

    res.json({ ok: true, stats });
  }));

  // ── POST /api/initiative/double-text ─────────────────────────────────
  // Generate a double text { originalMessage, context }

  app.post("/api/initiative/double-text", _auth, asyncHandler(async (req, res) => {
    const userId = _getUserId(req);
    const { originalMessage, context } = req.body || {};

    if (!originalMessage || typeof originalMessage !== "string") {
      return res.status(400).json({ ok: false, error: "originalMessage is required and must be a string" });
    }

    const result = engine.generateDoubleText(userId, originalMessage, context || {});

    res.json({ ok: true, ...result });
  }));
}
