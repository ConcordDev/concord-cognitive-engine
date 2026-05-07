// server/routes/lens-portals.js
// Lens portal buildings in Concordia: list + enter.

import { Router } from "express";
import crypto from "crypto";
import { awardExperience } from "../lib/skill-progression.js";

export default function createLensPortalsRouter({ requireAuth, db }) {
  const router = Router();

  // GET /api/lens-portals?worldId=concordia-hub
  // List all portals for a world, annotated with player access status.
  router.get("/", requireAuth, (req, res) => {
    const worldId = req.query.worldId || "concordia-hub";
    const userId  = req.user?.id || null;

    const portals = db.prepare(`
      SELECT p.*, n.name AS npc_name, n.title AS npc_title, n.greeting AS npc_greeting
      FROM lens_portals p
      LEFT JOIN lens_portal_npcs n ON n.portal_id = p.id
      WHERE p.world_id = ?
      ORDER BY p.required_skill_level ASC, p.district ASC
    `).all(worldId);

    // Get player's highest skill level (across all skill DTUs) to determine access
    let playerMaxSkill = 0;
    if (userId) {
      const row = db.prepare(`
        SELECT MAX(skill_level) as max_level FROM dtus
        WHERE creator_id = ? AND type = 'skill'
      `).get(userId);
      playerMaxSkill = row?.max_level || 0;
    }

    const annotated = portals.map(p => ({
      ...p,
      accessible: playerMaxSkill >= (p.required_skill_level || 0),
    }));

    res.json({ ok: true, portals: annotated, playerMaxSkill });
  });

  // POST /api/lens-portals/:id/enter
  // Log portal entry and award cross_world_use XP to the matching skill DTU.
  router.post("/:id/enter", requireAuth, async (req, res) => {
    const userId   = req.user.id;
    const portalId = req.params.id;

    const portal = db.prepare("SELECT * FROM lens_portals WHERE id = ?").get(portalId);
    if (!portal) return res.status(404).json({ ok: false, error: "portal_not_found" });

    // Check skill gate
    const row = db.prepare(`
      SELECT MAX(skill_level) as max_level FROM dtus
      WHERE creator_id = ? AND type = 'skill'
    `).get(userId);
    const playerMaxSkill = row?.max_level || 0;
    if (playerMaxSkill < (portal.required_skill_level || 0)) {
      return res.status(403).json({
        ok: false,
        error: "skill_too_low",
        required: portal.required_skill_level,
        current: playerMaxSkill,
      });
    }

    // Log entry
    db.prepare(`
      INSERT INTO lens_portal_entries (id, portal_id, user_id)
      VALUES (?, ?, ?)
    `).run(crypto.randomUUID(), portalId, userId);

    // Award cross_world_use XP to any matching skill DTU
    let xpResult = null;
    try {
      const lensDomainMap = {
        studio: "design", architecture: "construction", code: "engineering",
        materials: "metallurgy", graph: "systems_thinking", research: "scholarship",
        marketplace: "commerce", "game-design": "strategy", engineering: "engineering",
        science: "scholarship", "film-studios": "design", music: "design",
        quantum: "engineering", neuro: "scholarship", philosophy: "scholarship",
        linguistics: "scholarship", ml: "engineering", art: "design", collab: "strategy",
        chat: "commerce",
      };
      const domain = lensDomainMap[portal.lens_id];
      if (domain) {
        const skillDtu = db.prepare(`
          SELECT * FROM dtus
          WHERE creator_id = ? AND type = 'skill' AND (
            body_json LIKE ? OR domain = ?
          )
          ORDER BY skill_level DESC LIMIT 1
        `).get(userId, `%${domain}%`, domain);

        if (skillDtu) {
          xpResult = await awardExperience(
            skillDtu, "cross_world_use",
            { worldId: portal.world_id, userId, changedWorldState: true },
            db,
          );
        }
      }
    } catch { /* portal seed is best-effort */ }

    res.json({ ok: true, lensId: portal.lens_id, xpResult });
  });

  // GET /:portalId/entries — traversal feed for a portal.
  // POST /:id/enter writes lens_portal_entries on every player traversal
  // but pre-this-route nothing read them. Admin / portal-owner surfaces
  // (popularity heatmap, churn detection) consume this. Auth-gated since
  // traversal carries privacy weight (reveals which user visited which lens).
  router.get("/:portalId/entries", requireAuth, (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
      const sinceTs = req.query.sinceTs ? Number(req.query.sinceTs) : null;
      const where = ["portal_id = ?"];
      const args = [req.params.portalId];
      if (sinceTs) { where.push("entered_at >= ?"); args.push(sinceTs); }
      args.push(limit);
      const rows = db.prepare(
        `SELECT id, portal_id, user_id, entered_at
           FROM lens_portal_entries
          WHERE ${where.join(" AND ")}
          ORDER BY entered_at DESC
          LIMIT ?`,
      ).all(...args);
      res.json({ ok: true, portalId: req.params.portalId, entries: rows, count: rows.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
