// server/routes/avatars.js
// v2.0 Workstream 6a: per-user multiple avatars.
//
// Endpoints:
//   GET    /api/avatars                — list this user's avatars (lazy-creates a primary on first call)
//   POST   /api/avatars                — create a new avatar { name }
//   PUT    /api/avatars/:id/activate   — mark this avatar active for the session
//   DELETE /api/avatars/:id            — soft-delete (only if non-primary)

import express from "express";
import crypto from "node:crypto";

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

export default function createAvatarsRouter({ db, requireAuth }) {
  const router = express.Router();

  function ensurePrimary(userId) {
    let row = db.prepare(`SELECT * FROM avatars WHERE user_id = ? AND is_primary = 1`).get(userId);
    if (row) return row;
    const id = `av_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO avatars (id, user_id, name, slug, is_primary)
      VALUES (?, ?, ?, ?, 1)
    `).run(id, userId, "Primary", "primary");
    row = db.prepare(`SELECT * FROM avatars WHERE id = ?`).get(id);
    return row;
  }

  router.get("/", requireAuth, (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      ensurePrimary(userId);
      const rows = db.prepare(`SELECT id, user_id, name, slug, is_primary, created_at FROM avatars WHERE user_id = ? ORDER BY is_primary DESC, created_at ASC`).all(userId);
      const activeId = req.session?.activeAvatarId || rows.find((r) => r.is_primary)?.id || rows[0]?.id;
      res.json({ ok: true, avatars: rows, activeId });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.post("/", requireAuth, (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const name = String(req.body?.name || "").trim().slice(0, 64);
      if (!name) return res.status(400).json({ ok: false, error: "name_required" });
      const slug = slugify(name);
      const id = `av_${crypto.randomUUID()}`;
      try {
        db.prepare(`
          INSERT INTO avatars (id, user_id, name, slug, is_primary)
          VALUES (?, ?, ?, ?, 0)
        `).run(id, userId, name, slug);
      } catch (e) {
        if (String(e?.message || "").includes("UNIQUE")) {
          return res.status(409).json({ ok: false, error: "slug_taken" });
        }
        throw e;
      }
      const row = db.prepare(`SELECT id, user_id, name, slug, is_primary, created_at FROM avatars WHERE id = ?`).get(id);
      res.json({ ok: true, avatar: row });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.put("/:id/activate", requireAuth, (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const row = db.prepare(`SELECT * FROM avatars WHERE id = ? AND user_id = ?`).get(req.params.id, userId);
      if (!row) return res.status(404).json({ ok: false, error: "not_found_or_not_owned" });
      if (req.session) req.session.activeAvatarId = row.id;
      res.json({ ok: true, activeId: row.id });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  router.delete("/:id", requireAuth, (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const row = db.prepare(`SELECT * FROM avatars WHERE id = ? AND user_id = ?`).get(req.params.id, userId);
      if (!row) return res.status(404).json({ ok: false, error: "not_found_or_not_owned" });
      if (row.is_primary) return res.status(400).json({ ok: false, error: "cannot_delete_primary" });
      db.prepare(`DELETE FROM avatars WHERE id = ?`).run(row.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  return router;
}
