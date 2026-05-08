// server/routes/world-invites.js
//
// World invite CRUD for the World Terminal (/lenses/world/travel).
//
// GET    /api/worlds/invites              list current player's pending invites
// POST   /api/worlds/invites              create (from authenticated user)
// POST   /api/worlds/invites/:id/accept   mark accepted (caller must travel separately)
// POST   /api/worlds/invites/:id/decline  mark declined
//
// Authorisation:
//   - GET / accept / decline: caller must be invitee (to_user_id).
//   - POST: any authenticated user can invite (rate-limited at the
//     middleware layer; abuse handled by recipient declines).
//
// All writes guarded so an unauthenticated caller never gets behind
// the user filter.

import { randomUUID } from "node:crypto";

function _userId(req) {
  return req?.user?.id || req?.user?.userId || req?.session?.user?.id || null;
}

export function registerWorldInviteRoutes(app, deps) {
  const { db, asyncHandler, requireAuth } = deps;

  app.get("/api/worlds/invites", requireAuth(), asyncHandler(async (req, res) => {
    const userId = _userId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });

    // Auto-expire stale invites at read time so the response only shows
    // currently-actionable rows. Cheap because the index covers the path.
    db.prepare(`
      UPDATE world_invites
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= datetime('now')
    `).run();

    const rows = db.prepare(`
      SELECT id, from_user_id AS fromUser, world_id AS worldId,
             world_name AS worldName, created_at AS timestamp
      FROM world_invites
      WHERE to_user_id = ? AND status = 'pending'
      ORDER BY created_at DESC
    `).all(userId);

    res.json({ ok: true, invites: rows });
  }));

  app.post("/api/worlds/invites", requireAuth(), asyncHandler(async (req, res) => {
    const userId = _userId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });

    const { toUserId, worldId, worldName } = req.body || {};
    if (!toUserId || !worldId || !worldName) {
      return res.status(400).json({ ok: false, error: "toUserId, worldId, worldName required" });
    }
    if (toUserId === userId) {
      return res.status(400).json({ ok: false, error: "cannot_invite_self" });
    }

    const id = randomUUID();
    db.prepare(`
      INSERT INTO world_invites (id, from_user_id, to_user_id, world_id, world_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, toUserId, worldId, worldName);

    res.json({ ok: true, id });
  }));

  app.post("/api/worlds/invites/:id/accept", requireAuth(), asyncHandler(async (req, res) => {
    const userId = _userId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });

    const result = db.prepare(`
      UPDATE world_invites
      SET status = 'accepted', responded_at = datetime('now')
      WHERE id = ? AND to_user_id = ? AND status = 'pending'
    `).run(req.params.id, userId);

    if (result.changes === 0) {
      return res.status(404).json({ ok: false, error: "invite_not_found_or_not_actionable" });
    }
    res.json({ ok: true });
  }));

  app.post("/api/worlds/invites/:id/decline", requireAuth(), asyncHandler(async (req, res) => {
    const userId = _userId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });

    const result = db.prepare(`
      UPDATE world_invites
      SET status = 'declined', responded_at = datetime('now')
      WHERE id = ? AND to_user_id = ? AND status = 'pending'
    `).run(req.params.id, userId);

    if (result.changes === 0) {
      return res.status(404).json({ ok: false, error: "invite_not_found_or_not_actionable" });
    }
    res.json({ ok: true });
  }));
}
