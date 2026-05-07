// server/routes/kingdoms.js
//
// REST surface for the kingdom system. Found, decree, contest, join,
// list residents.

import { Router } from "express";
import {
  foundKingdom,
  listKingdoms,
  getKingdom,
  enactDecree,
  listDecrees,
  contestKingdom,
  contributeContestStrength,
  resolveContest,
  joinKingdom,
  listResidents,
  pointInKingdom,
  DECREE_KINDS,
} from "../lib/kingdom.js";

export default function createKingdomsRouter({ requireAuth, db, state, realtimeEmit }) {
  const router = Router();

  // GET /api/kingdoms?worldId=…
  router.get("/", requireAuth, (req, res) => {
    try {
      const worldId = req.query?.worldId ? String(req.query.worldId) : null;
      const rows = listKingdoms(db, { worldId });
      res.json({ ok: true, kingdoms: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/kingdoms — body: { name, worldId, regionPolygon, hqDistrictId?, storylineId? }
  router.post("/", requireAuth, (req, res) => {
    try {
      const { name, worldId, regionPolygon, hqDistrictId, storylineId } = req.body || {};
      const result = foundKingdom(db, {
        rulerId: req.user.id,
        worldId: worldId ? String(worldId).slice(0, 64) : "concordia-hub",
        regionPolygon,
        name: String(name || "").slice(0, 80),
        storylineId, hqDistrictId,
      });
      if (result.ok && realtimeEmit) {
        try { realtimeEmit("kingdom:founded", { kingdomId: result.kingdomId, rulerId: req.user.id, worldId, name }); }
        catch { /* ok */ }
      }
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // GET /api/kingdoms/:id
  router.get("/:id", requireAuth, (req, res) => {
    try {
      const k = getKingdom(db, req.params.id);
      if (!k) return res.status(404).json({ ok: false, error: "kingdom_not_found" });
      const decrees  = listDecrees(db, req.params.id, { activeOnly: false });
      const residents = listResidents(db, req.params.id);
      res.json({ ok: true, kingdom: k, decrees, residents });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/kingdoms/:id/decree — body: { decreeKind, parameters?, durationMs? }
  router.post("/:id/decree", requireAuth, async (req, res) => {
    try {
      const k = getKingdom(db, req.params.id);
      if (!k) return res.status(404).json({ ok: false, error: "kingdom_not_found" });
      if (k.ruler_user_id !== req.user.id) {
        return res.status(403).json({ ok: false, error: "not_ruler" });
      }
      const { decreeKind, parameters, durationMs } = req.body || {};
      const result = await enactDecree(db, req.params.id, decreeKind, parameters, {
        state, durationMs,
      });
      if (result.ok && realtimeEmit) {
        try {
          realtimeEmit("kingdom:decree-enacted", {
            kingdomId: req.params.id,
            decreeId: result.decreeId,
            decreeKind,
            activationState: result.activationState,
            alignmentScore: result.alignmentScore,
          });
        } catch { /* ok */ }
      }
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/kingdoms/:id/contest — body: { contestKind }
  router.post("/:id/contest", requireAuth, (req, res) => {
    try {
      const result = contestKingdom(db, req.params.id, req.user.id, req.body?.contestKind || "siege");
      if (result.ok && realtimeEmit) {
        try {
          realtimeEmit("kingdom:contested", {
            kingdomId: req.params.id, contestId: result.contestId,
            claimantId: req.user.id, contestKind: req.body?.contestKind || "siege",
          });
        } catch { /* ok */ }
      }
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/kingdoms/contests/:contestId/contribute — body: { amount }
  router.post("/contests/:contestId/contribute", requireAuth, (req, res) => {
    try {
      const amount = Math.max(0, Math.min(50, Number(req.body?.amount) || 1));
      res.json(contributeContestStrength(db, req.params.contestId, amount));
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/kingdoms/contests/:contestId/resolve
  router.post("/contests/:contestId/resolve", requireAuth, (req, res) => {
    try {
      const result = resolveContest(db, req.params.contestId);
      if (result.ok && realtimeEmit) {
        try { realtimeEmit("kingdom:fallen", { contestId: req.params.contestId, outcome: result.outcome }); }
        catch { /* ok */ }
      }
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/kingdoms/:id/join
  router.post("/:id/join", requireAuth, (req, res) => {
    try {
      const role = req.body?.role && ["citizen", "noble", "guard"].includes(req.body.role)
        ? req.body.role : "citizen";
      res.json(joinKingdom(db, req.params.id, req.user.id, role));
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // GET /api/kingdoms/at?worldId&x&z — locate kingdom at world coordinates
  router.get("/at/lookup", requireAuth, (req, res) => {
    try {
      const worldId = req.query?.worldId ? String(req.query.worldId) : "concordia-hub";
      const x = Number(req.query?.x);
      const z = Number(req.query?.z);
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        return res.status(400).json({ ok: false, error: "x_z_required" });
      }
      const k = pointInKingdom(db, worldId, x, z);
      res.json({ ok: true, kingdom: k });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // GET /api/kingdoms/_meta/decree-kinds — exposes the catalog so UI can
  // populate the decree composer dropdown.
  router.get("/_meta/decree-kinds", requireAuth, (_req, res) => {
    res.json({ ok: true, kinds: DECREE_KINDS });
  });

  return router;
}
