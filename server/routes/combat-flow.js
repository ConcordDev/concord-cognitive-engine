// server/routes/combat-flow.js
//
// REST surface for the procedural emergent combat substrate. Mounted at
// /api/combat-flow.
//
// Endpoints:
//   GET  /context            — current context for the calling player
//                              (?inVehicle=1 &hackerMode=1 query overrides)
//   GET  /profile            — fighter flow profile (totals + per-context)
//   GET  /flows/recent       — most recent flow rows for the caller
//   GET  /combos             — fighter's evolved combos (?context=ground)
//   POST /evolve             — trigger an evolution pass (auto-runs every
//                              N combat events too; this is the manual lever)
//   POST /suggest            — { currentChain, context } → next-step hint
//   GET  /spells             — caller's spell DTUs (used by hotbar)
//
// Read endpoints are auth'd but cheap; the heavy work happens on combat
// socket events, not here.

import { Router } from "express";
import { detectCombatContext } from "../lib/combat/context-engine.js";
import {
  getFighterFlowProfile,
  getRecentFlows,
} from "../lib/combat/flow-recorder.js";
import {
  evolveFighterCombos,
  suggestNextAction,
  listFighterCombos,
} from "../lib/combat/flow-engine.js";
import { getLoadout, equipItem } from "../lib/combat/loadout.js";

export default function createCombatFlowRouter({ db, requireAuth }) {
  const router = Router();
  // requireAuth ships in two shapes across this codebase — a factory and a
  // ready-made middleware. Normalise so the route file doesn't care.
  const auth = typeof requireAuth === "function" && requireAuth.length === 0
    ? requireAuth()
    : requireAuth;

  function uidFrom(req) {
    return req.user?.id || req.headers["x-user-id"] || null;
  }

  // GET /context — context for the caller, with query overrides for the
  // hacker-mode toggle and vehicle flag (the world page already knows these
  // client-side; this endpoint just standardises the modifier resolution).
  router.get("/context", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const x = Number(req.query.x ?? 0);
      const y = Number(req.query.y ?? 0);
      const z = Number(req.query.z ?? 0);
      const groundY = Number(req.query.groundY ?? 0);
      const result = detectCombatContext({
        position: { x, y, z },
        velocity: {
          x: Number(req.query.vx ?? 0),
          y: Number(req.query.vy ?? 0),
          z: Number(req.query.vz ?? 0),
        },
        groundY,
        waterSurfaceY: req.query.waterY != null ? Number(req.query.waterY) : null,
        inVehicle: req.query.inVehicle === "1" || req.query.inVehicle === "true",
        hackerMode: req.query.hackerMode === "1" || req.query.hackerMode === "true",
        grounded: req.query.grounded !== "0",
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get("/profile", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const profile = getFighterFlowProfile(db, userId);
      res.json({ ok: true, profile });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get("/flows/recent", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const limit   = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
      const context = req.query.context ? String(req.query.context) : null;
      const flows = getRecentFlows(db, userId, { limit, context });
      res.json({ ok: true, flows, count: flows.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get("/combos", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const context = req.query.context ? String(req.query.context) : null;
      const combos = listFighterCombos(db, userId, context);
      res.json({ ok: true, combos, count: combos.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/evolve", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const result = evolveFighterCombos(db, userId, "player");
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/suggest", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const { currentChain, context } = req.body || {};
      if (!context) return res.status(400).json({ ok: false, error: "context_required" });
      const suggestion = suggestNextAction(db, userId, currentChain || [], context);
      res.json({ ok: true, suggestion });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /spells — caller's spell DTUs. The crafting engine produces these
  // via /api/crafting/skills/design with output_type='spell', so we just
  // surface them here for the hotbar to enumerate.
  router.get("/spells", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const rows = db.prepare(`
        SELECT id, title AS name, type, data, skill_level, created_at
        FROM dtus
        WHERE creator_id = ? AND type IN ('spell', 'ability')
        ORDER BY created_at DESC LIMIT 50
      `).all(userId);
      const spells = rows.map((r) => {
        let data = {}; try { data = JSON.parse(r.data); } catch { data = {}; }
        return {
          id: r.id,
          name: r.name,
          type: r.type,
          skillLevel: r.skill_level,
          createdAt: r.created_at,
          // Surface a few fields the hotbar wants up front
          element:    data?.spec?.element ?? data?.element ?? null,
          contexts:   data?.spec?.contexts ?? data?.contexts ?? [],
          costs:      data?.spec?.costs ?? data?.costs ?? {},
          effects:    data?.spec?.effects ?? data?.effects ?? [],
        };
      });
      res.json({ ok: true, spells, count: spells.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Dual-hand loadout ────────────────────────────────────────────────────
  // GET /loadout — caller's right/left/two-hand equipment + inferred class
  router.get("/loadout", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const loadout = getLoadout(db, userId);
      res.json({ ok: true, loadout });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /equip — { slot: 'right_hand'|'left_hand'|'head'|'body'|'accessory',
  //                 itemId: string|null }
  // Two-handed weapons auto-occupy both hand slots regardless of the slot
  // argument; pass itemId=null to unequip the supplied slot.
  router.post("/equip", auth, (req, res) => {
    try {
      const userId = uidFrom(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const { slot, itemId } = req.body || {};
      if (!slot) return res.status(400).json({ ok: false, error: "slot_required" });
      const result = equipItem(db, userId, String(slot), itemId ? String(itemId) : null);
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
