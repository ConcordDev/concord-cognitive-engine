// server/routes/brain-mode.js
//
// High Power Mode toggle + per-user FCFS quota display.
//
// GET  /api/brain-mode         → { mode, brain_mode_set_at }
// POST /api/brain-mode         → { mode: 'private' | 'high_power' }
// GET  /api/brain-mode/quota   → { perProvider, resetsAt, callsToday }

import logger from '../logger.js';
import { fcfsGetStatusDb } from '../lib/fcfs-quota-db.js';
import { listAvailableProviders } from '../lib/free-cloud-router.js';

export function registerBrainModeRoutes(app, deps) {
  const { db, requireAuth } = deps;

  // GET current mode
  app.get('/api/brain-mode', requireAuth, (req, res) => {
    try {
      const userId = req.user?.id || req.user?.userId;
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const row = db.prepare('SELECT brain_mode, brain_mode_set_at FROM users WHERE id = ?').get(userId);
      res.json({ ok: true, mode: row?.brain_mode || 'private', brain_mode_set_at: row?.brain_mode_set_at || null });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST change mode
  app.post('/api/brain-mode', requireAuth, (req, res) => {
    try {
      const userId = req.user?.id || req.user?.userId;
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const { mode } = req.body || {};
      if (!['private', 'high_power'].includes(mode)) {
        return res.status(400).json({ ok: false, error: 'invalid_mode' });
      }
      db.prepare('UPDATE users SET brain_mode = ?, brain_mode_set_at = ? WHERE id = ?')
        .run(mode, Date.now(), userId);
      globalThis.__concordBustUserCache?.(userId);
      logger.log('info', 'brain_mode_changed', { userId, mode });
      res.json({ ok: true, mode });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET quota
  app.get('/api/brain-mode/quota', requireAuth, (req, res) => {
    try {
      const userId = req.user?.id || req.user?.userId;
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const status = fcfsGetStatusDb(db, userId);
      const providers = listAvailableProviders();
      res.json({ ok: true, ...status, providers });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}

export default { registerBrainModeRoutes };
