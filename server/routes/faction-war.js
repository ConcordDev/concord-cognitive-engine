// server/routes/faction-war.js
//
// Endpoints for the shared faction-war event layer. Mounted at
// /api/faction-war.
//
// Endpoints:
//   POST  /spawn          — admin/test: spawn a war between two factions
//   GET   /active         — list active wars + tally
//   GET   /:warId         — full detail for one war (npcs, tally, status)
//   POST  /tick           — admin: force a tick (debug); also runs from
//                           the heartbeat governor every N ticks.

import { Router } from "express";
import {
  spawnFactionWar,
  tickAllFactionWars,
  listActiveWars,
} from "../lib/combat/faction-war.js";

export default function createFactionWarRouter({ db, requireAuth }) {
  const router = Router();
  const auth = typeof requireAuth === "function" && requireAuth.length === 0
    ? requireAuth()
    : requireAuth;

  router.post("/spawn", auth, (req, res) => {
    try {
      const { sideA, sideB, spawnsPerSide, eventId, cityId } = req.body || {};
      if (!sideA || !sideB) return res.status(400).json({ ok: false, error: "sideA and sideB required" });
      const result = spawnFactionWar(db, {
        sideA: String(sideA).slice(0, 64),
        sideB: String(sideB).slice(0, 64),
        spawnsPerSide: Number(spawnsPerSide || 8),
        eventId: eventId ? String(eventId) : null,
        cityId:  cityId  ? String(cityId)  : null,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get("/active", (_req, res) => {
    try {
      const wars = listActiveWars(db);
      res.json({ ok: true, wars, count: wars.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get("/:warId", (req, res) => {
    try {
      const wars = listActiveWars(db);
      const war = wars.find((w) => w.id === req.params.warId);
      if (!war) return res.status(404).json({ ok: false, error: "war_not_found" });
      res.json({ ok: true, war });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/tick", auth, (_req, res) => {
    try {
      const result = tickAllFactionWars(db);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
