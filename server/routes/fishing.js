// server/routes/fishing.js
//
// REST surface for the fishing minigame.

import { Router } from "express";
import {
  castLine,
  resolveFishCatch,
  mintFishCatch,
  getSession,
  listFishForWorld,
  readFishingSkill,
  clampTensionHint,
  measureReactionMs,
  pickBiteFish,
} from "../lib/fishing.js";

export default function createFishingRouter({ requireAuth, db, realtimeEmit }) {
  const router = Router();

  // POST /api/fishing/cast — body: { worldId?, x, z, biome? }
  router.post("/cast", requireAuth, (req, res) => {
    try {
      const { worldId, x, z, biome } = req.body || {};
      const result = castLine({
        userId: req.user.id,
        worldId: worldId ? String(worldId).slice(0, 64) : "concordia-hub",
        x: Number(x) || 0,
        z: Number(z) || 0,
        biome: biome ? String(biome).slice(0, 32) : "water",
      });
      if (result.ok && realtimeEmit) {
        // DET-C dead-event-listener sweep (batch 9): this route used to also
        // fire a 'fishing:cast' realtime event scoped to the casting user's
        // own room. Checked the whole frontend (+ world-lens-godot,
        // concord-mobile) — nothing ever subscribed to it. The reason: the
        // caster already gets sessionId + biteAtEpochMs synchronously in
        // this very HTTP response, and FishingMinigameOverlay.tsx drives its
        // 'casting' phase off that response directly, not off a socket
        // round-trip. A subscriber here would just be a second path setting
        // the same state the HTTP response already set — dead weight, not a
        // missing feature. Removed the emit; 'fishing:bite' below is kept
        // as-is because it fires later (after a real setTimeout delay) and
        // IS consumed (FishingMinigameOverlay subscribes to it to know when
        // the bite window opens).
        //
        // Schedule the bite emit. Fire-and-forget: realtimeEmit
        // shouldn't throw, but we wrap in try/catch in case the io
        // server churns mid-timer.
        const wait = Math.max(0, result.biteAtEpochMs - Date.now());
        setTimeout(() => {
          try {
            const s = getSession(result.sessionId);
            if (s && !s.resolved) {
              // F5 fix: pick the species NOW (bite time), not at reel-resolve
              // time — so the bite event can honestly tell the client what
              // it's fighting (name/rarity/abilities), instead of the fight
              // being species-blind and the catch a surprise after the fact.
              const skill = readFishingSkill(db, req.user.id);
              const picked = pickBiteFish(result.sessionId, { fishingSkill: skill });
              const fishInfo = picked.ok ? {
                fishId: picked.fish.id,
                fishName: picked.fish.name,
                rarity: picked.fish.rarity,
                abilities: Array.isArray(picked.fish.abilities) ? picked.fish.abilities : [],
              } : {};
              realtimeEmit("fishing:bite", { userId: req.user.id, sessionId: result.sessionId, ...fishInfo }, { userId: req.user.id });
            }
          } catch { /* ok */ }
        }, wait);
      }
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/fishing/:sessionId/reel — body: { reactionMs, tensionAccuracy, fishingSkill? }
  router.post("/:sessionId/reel", requireAuth, (req, res) => {
    try {
      const session = getSession(req.params.sessionId);
      // Same gate as fishing.reel: another user must not resolve or mint this cast.
      if (!session || session.userId !== req.user.id) {
        return res.json({ ok: false, error: "session_not_found" });
      }
      const result = resolveFishCatch({
        sessionId: req.params.sessionId,
        reactionMs: measureReactionMs(session),
        tensionAccuracy: clampTensionHint((req.body || {}).tensionAccuracy),
        fishingSkill: readFishingSkill(db, req.user.id),
      });
      if (!result.ok) return res.json(result);
      const mint = mintFishCatch(db, {
        userId: req.user.id,
        worldId: session?.worldId || "concordia-hub",
        fish: result.fish,
        qualityScore: result.qualityScore,
        sessionId: req.params.sessionId,
      });
      if (mint.ok && realtimeEmit) {
        try {
          realtimeEmit("fishing:caught", {
            userId: req.user.id,
            sessionId: req.params.sessionId,
            fishId: result.fish.id,
            fishName: result.fish.name,
            qualityScore: result.qualityScore,
            tier: result.tier,
          });
        } catch { /* ok */ }
      }
      // F2 fix: same honesty fold as the fishing.reel macro — don't report
      // ok:true from resolveFishCatch alone when the mint itself failed.
      res.json({ ...result, ok: result.ok && mint.ok, mint });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // GET /api/fishing/baseline-species?worldId=&biome=
  router.get("/baseline-species", requireAuth, (req, res) => {
    try {
      const worldId = req.query?.worldId ? String(req.query.worldId) : "concordia-hub";
      const biome = req.query?.biome ? String(req.query.biome) : null;
      res.json({ ok: true, fish: listFishForWorld(worldId, biome) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  return router;
}
