// server/routes/quest-authority.js
//
// POST /api/quests/interact — server-authored branching quest text.
// Auth required. Returns prose from content store, not Unity-only offline strings.

import { Router } from "express";
import { interactQuest } from "../lib/concordia/quest-authority.js";

export default function createQuestAuthorityRouter({ requireAuth }) {
  const router = Router();
  const auth = typeof requireAuth === "function" && requireAuth.length === 0 ? requireAuth() : requireAuth;

  // Kitchen/Editor loopback: WS already accepts unity-local-guest when
  // NODE_ENV !== production. Mirror that for HTTP hit/quest so Editor REST
  // bind works without a forged JWT. Production still requires real auth.
  const kitchenGuestOrAuth = (req, res, next) => {
    if (!req.user) {
      const h = String(req.headers?.authorization || "");
      if (process.env.NODE_ENV !== "production" && h === "Bearer unity-local-guest") {
        req.user = { id: "unity-local-guest", username: "unity-local", role: "member" };
      }
    }
    return auth(req, res, next);
  };
  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;

  router.post("/interact", kitchenGuestOrAuth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });

      const body = req.body || {};
      const questId = body.questId || body.id || body.targetId || body.title || null;
      const optionId = body.optionId || body.choice || body.branch || null;
      const worldId = body.worldId || "concordia-hub";

      const result = interactQuest({
        questId,
        optionId,
        worldId,
        targetId: body.targetId || null,
      });

      if (!result.ok) {
        const status = result.error === "quest_not_found" ? 404
          : result.error === "missing_quest" ? 400
          : result.error === "unknown_option" ? 400
          : 400;
        return res.status(status).json(result);
      }

      return res.json({
        ...result,
        userId,
        ts: new Date().toISOString(),
      });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  return router;
}
