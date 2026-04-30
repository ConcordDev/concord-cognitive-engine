// server/routes/tools.js
// Tool tree crafting routes. Mounted at /api/tools.

import { Router } from "express";
import { TOOL_RECIPES, getPlayerTools, getPlayerToolTier, craftTool } from "../lib/tool-tree.js";

export default function createToolsRouter({ requireAuth, db }) {
  const router = Router();
  const auth = requireAuth;

  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;

  // GET /api/tools/recipes — full recipe list (no auth needed)
  router.get("/recipes", (_req, res) => {
    res.json({ ok: true, recipes: TOOL_RECIPES });
  });

  // GET /api/tools/mine — player's owned tools + current tier
  router.get("/mine", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const tools = getPlayerTools(db, userId);
      const tier = getPlayerToolTier(db, userId);
      res.json({ ok: true, tools, tier });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // POST /api/tools/craft — attempt to craft a tool from a recipe
  router.post("/craft", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const { recipeId } = req.body;
      if (!recipeId) return res.status(400).json({ ok: false, error: "recipeId required" });
      const result = craftTool(db, userId, recipeId);
      res.status(result.ok ? 201 : 400).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  return router;
}
