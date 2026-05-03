// server/routes/combat.js
//
// Server-authoritative combat endpoints. Mounted at /api/combat.
//
//   POST  /attack             — declare an attack swing (cooldown gated)
//   POST  /hit                — submit a damage event for validation + broadcast
//   POST  /death              — declare a victim death
//
// All endpoints require auth. Hits are validated against attacker reach,
// weapon damage cap, and cooldown. Failed validation returns 400 and is
// never broadcast to peers.
//
// Anti-cheat invariant: the server treats whatever the client claims about
// damage and reach as a CEILING — it can only reduce, never increase.

import { Router } from "express";
import {
  recordAttackSwing,
  validateHit,
  broadcastAttack,
  broadcastHit,
  broadcastDeath,
} from "../lib/combat-netcode.js";

export default function createCombatRouter({ requireAuth, REALTIME, getUserPosition, getNearbyUserIds, db = null }) {
  const router = Router();
  const auth = typeof requireAuth === "function" && requireAuth.length === 0 ? requireAuth() : requireAuth;
  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;

  // POST /api/combat/attack
  router.post("/attack", auth, (req, res) => {
    try {
      const attackerId = _userId(req);
      if (!attackerId) return res.status(401).json({ ok: false, error: "auth_required" });

      const { weapon = "fist", animation = "swing", direction = null, cooldownMs = 200 } = req.body || {};

      const swing = recordAttackSwing(attackerId, { cooldownMs });
      if (!swing.allowed) {
        return res.status(429).json({ ok: false, reason: swing.reason, remainingMs: swing.remainingMs });
      }

      const pos = getUserPosition?.(attackerId);
      if (!pos) return res.status(400).json({ ok: false, error: "no_presence" });

      const r = broadcastAttack(REALTIME, getNearbyUserIds, {
        attackerId,
        cityId:   pos.cityId,
        position: { x: pos.x, y: pos.y, z: pos.z },
        weapon, animation, direction,
      });
      res.json({ ok: true, delivered: r.delivered });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/combat/hit
  router.post("/hit", auth, (req, res) => {
    try {
      const attackerId = _userId(req);
      if (!attackerId) return res.status(401).json({ ok: false, error: "auth_required" });

      const { victimId, damage, isCrit = false, weapon = {}, hitDirection = null } = req.body || {};
      if (!victimId || typeof damage !== "number") {
        return res.status(400).json({ ok: false, error: "victimId + damage required" });
      }

      const attackerPos = getUserPosition?.(attackerId);
      const victimPos   = getUserPosition?.(victimId);
      if (!attackerPos || !victimPos) {
        return res.status(400).json({ ok: false, error: "no_presence_for_combatants" });
      }

      const v = validateHit({
        attacker: { id: attackerId, position: attackerPos, cityId: attackerPos.cityId },
        victim:   { id: victimId,   position: victimPos,   cityId: victimPos.cityId   },
        weapon,
        damage,
        isCrit,
      });
      if (!v.ok) return res.status(400).json({ ok: false, reason: v.reason });

      // Persist the damage exchange for audit + economy hooks.
      if (db) {
        try {
          db.prepare(`
            INSERT INTO world_events_log (id, city_id, user_id, trigger_id, action, context_json, fired_at)
            VALUES (lower(hex(randomblob(8))), ?, ?, 'combat:hit', ?, ?, datetime('now'))
          `).run(
            attackerPos.cityId,
            attackerId,
            String(damage),
            JSON.stringify({ victimId, damage, isCrit, weapon: weapon?.name ?? null }),
          );
        } catch { /* world_events_log may not exist on older deploys */ }
      }

      const r = broadcastHit(REALTIME, getNearbyUserIds, {
        attacker: { id: attackerId, position: attackerPos, cityId: attackerPos.cityId },
        victim:   { id: victimId,   position: victimPos,   cityId: victimPos.cityId   },
        weapon, damage, isCrit, hitDirection,
      });

      res.json({ ok: true, delivered: r.delivered });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/combat/death
  router.post("/death", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });

      const { victimId, killerId = null } = req.body || {};
      const target = victimId || userId; // self-report by default

      const pos = getUserPosition?.(target);
      if (!pos) return res.status(400).json({ ok: false, error: "no_presence" });

      if (db) {
        try {
          db.prepare(`
            INSERT INTO world_events_log (id, city_id, user_id, trigger_id, action, context_json, fired_at)
            VALUES (lower(hex(randomblob(8))), ?, ?, 'combat:death', ?, ?, datetime('now'))
          `).run(pos.cityId, target, "death", JSON.stringify({ killerId }));
        } catch { /* best-effort */ }
      }

      const r = broadcastDeath(REALTIME, getNearbyUserIds, {
        victimId: target,
        killerId,
        cityId:   pos.cityId,
        position: { x: pos.x, y: pos.y, z: pos.z },
      });
      res.json({ ok: true, delivered: r.delivered });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  return router;
}
