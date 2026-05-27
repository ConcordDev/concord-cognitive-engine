// server/routes/world-props.js
//
// Wave G1 — REST surface for interactable world props.
//
//   GET  /api/world-props?worldId=...&district=...&kind=...
//   GET  /api/world-props/near?worldId=...&x=&z=&r=
//   GET  /api/world-props/:propId
//   POST /api/world-props/:propId/interact  { kind, position: {x,z} }
//
// Public-readable on GET; interact requires auth.

import express from "express";
import { listInWorld, listNearby, getProp, interact } from "../lib/world-props.js";

// Minimum response delay so the avatar animation plays through.
const MIN_INTERACT_RESPONSE_MS = 500;

export default function createWorldPropsRouter({ db, requireAuth }) {
  const router = express.Router();

  router.get("/", (req, res) => {
    const worldId = String(req.query?.worldId || "concordia-hub");
    const district = req.query?.district ? String(req.query.district) : null;
    const kind = req.query?.kind ? String(req.query.kind) : null;
    const props = listInWorld(db, worldId, { district, kind, limit: 500 });
    return res.json({ ok: true, worldId, props });
  });

  router.get("/near", (req, res) => {
    const worldId = String(req.query?.worldId || "concordia-hub");
    const x = Number(req.query?.x ?? 0);
    const z = Number(req.query?.z ?? 0);
    const r = Math.min(200, Math.max(1, Number(req.query?.r ?? 40)));
    const props = listNearby(db, worldId, x, z, r);
    return res.json({ ok: true, worldId, x, z, r, props });
  });

  router.get("/:propId", (req, res) => {
    const p = getProp(db, req.params.propId);
    if (!p) return res.status(404).json({ ok: false, error: "prop_not_found" });
    return res.json({ ok: true, prop: p });
  });

  router.post("/:propId/interact", requireAuth, async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    const body = req.body || {};
    const startedAt = Date.now();
    const result = interact(db, {
      propId: req.params.propId,
      userId,
      kind: body.kind || null,
      position: body.position || null,
    });

    // Emit realtime so other players in the world can see the action.
    if (result.ok && result.worldId) {
      try {
        req.app.locals.io?.to?.(`world:${result.worldId}`)?.emit?.("prop:interacted", {
          worldId: result.worldId,
          propId: result.propId,
          userId,
          kind: result.kind,
          clip: result.clip,
        });
      } catch { /* ok */ }
    }

    // Enforce minimum response delay so animation plays through.
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_INTERACT_RESPONSE_MS) {
      await new Promise((r) => setTimeout(r, MIN_INTERACT_RESPONSE_MS - elapsed));
    }

    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  });

  return router;
}
