// server/routes/combat.js
//
// Server-authoritative combat endpoints. Mounted at /api/combat.
//
//   POST  /hit                — submit a damage event for validation + broadcast
//   POST  /death              — declare a victim death
//
// All endpoints require auth. Hits are validated against attacker reach,
// weapon damage cap, and cooldown. Failed validation returns 400 and is
// never broadcast to peers.
//
// Anti-cheat invariant: the server treats whatever the client claims about
// damage and reach as a CEILING — it can only reduce, never increase.
//
// Dead-event-listener follow-up (2026-07-24): POST /attack (which declared
// an attack swing and broadcast 'combat:attack' via combat-netcode.js's
// broadcastAttack()) is retired — nothing ever called it (see
// lib/combat-netcode.js's module header RESOLVED note) and its sole event
// had zero frontend subscribers. `recordAttackSwing` (the cooldown gate it
// used) stays exported from combat-netcode.js for its own tests, just no
// longer wired to a route.

import { Router } from "express";
import {
  validateHit,
  broadcastHit,
  broadcastDeath,
} from "../lib/combat-netcode.js";
import {
  applyAuthoritativeHit,
  ensureActor,
  getActor,
} from "../lib/combat-hp-authority.js";

export default function createCombatRouter({ requireAuth, REALTIME, getUserPosition, getNearbyUserIds, db = null }) {
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

  // POST /api/combat/hit
  // Concordia FULL server-authority: prefer combat-hp-authority (momentum×poise)
  // so TrainingDummy / offline targets return {ok, hpBefore, hpAfter, damage}.
  // Presence PvP path remains for peer-to-peer when both actors are in cityPresence.
  router.post("/hit", kitchenGuestOrAuth, async (req, res) => {
    try {
      const attackerId = _userId(req);
      if (!attackerId) return res.status(401).json({ ok: false, error: "auth_required" });

      const body = req.body || {};
      const victimId = body.victimId || body.targetId || null;
      const damageHint = typeof body.damage === "number" ? body.damage
        : typeof body.baseDamage === "number" ? body.baseDamage
        : null;
      const isCrit = !!body.isCrit;
      const weapon = body.weapon || {};
      const weaponKind = typeof weapon === "string" ? weapon : (weapon?.name || weapon?.kind || "sword");
      const hitDirection = body.hitDirection || null;
      const worldId = body.worldId || body.cityId || "concordia-hub";

      if (!victimId) {
        return res.status(400).json({ ok: false, error: "victimId + damage required", reason: "missing_victim" });
      }

      // Great Refusal — hub neutral zone (same gate as WS combat:attack).
      try {
        const { checkHostilityAllowed } = await import("../lib/concordia/neutral-zone.js");
        const hostility = checkHostilityAllowed(null, String(worldId), attackerId);
        if (hostility && hostility.allowed === false) {
          return res.json({
            ok: true,
            refused: true,
            reason: hostility.reason || "neutral_zone_concordia",
            damage: 0,
            hpBefore: getActor(victimId)?.hp ?? null,
            hpAfter: getActor(victimId)?.hp ?? null,
            authority: "server",
          });
        }
      } catch { /* neutral-zone optional */ }

      const attackerPos = getUserPosition?.(attackerId);
      const victimPos = getUserPosition?.(victimId);
      const bothPresent = !!(attackerPos && victimPos) && typeof damageHint === "number";

      // Peer PvP with presence: keep netcode validate + broadcast.
      if (bothPresent) {
        const v = validateHit({
          attacker: { id: attackerId, position: attackerPos, cityId: attackerPos.cityId },
          victim:   { id: victimId,   position: victimPos,   cityId: victimPos.cityId   },
          weapon: typeof weapon === "object" ? weapon : { name: weaponKind },
          damage: damageHint,
          isCrit,
        });
        if (!v.ok) return res.status(400).json({ ok: false, refused: true, reason: v.reason, damage: 0 });

        if (db) {
          try {
            db.prepare(`
              INSERT INTO world_events_log (id, city_id, user_id, trigger_id, action, context_json, fired_at)
              VALUES (lower(hex(randomblob(8))), ?, ?, 'combat:hit', ?, ?, datetime('now'))
            `).run(
              attackerPos.cityId,
              attackerId,
              String(damageHint),
              JSON.stringify({ victimId, damage: damageHint, isCrit, weapon: weaponKind }),
            );
          } catch { /* optional */ }
        }

        const r = broadcastHit(REALTIME, getNearbyUserIds, {
          attacker: { id: attackerId, position: attackerPos, cityId: attackerPos.cityId },
          victim:   { id: victimId,   position: victimPos,   cityId: victimPos.cityId   },
          weapon: typeof weapon === "object" ? weapon : { name: weaponKind },
          damage: damageHint, isCrit, hitDirection,
        });

        return res.json({
          ok: true,
          authority: "combat-netcode",
          delivered: r.delivered,
          damage: damageHint,
          hpBefore: null,
          hpAfter: null,
          note: "presence_pvp_broadcast",
        });
      }

      // Concordia / dummy / offline-presence path — combat-hp-authority is SoT.
      if (typeof damageHint !== "number") {
        return res.status(400).json({ ok: false, error: "victimId + damage required", reason: "missing_damage" });
      }

      ensureActor(victimId, { worldId: String(worldId), hp: 80 });
      const result = applyAuthoritativeHit({
        attackerId,
        targetId: victimId,
        weapon: weaponKind,
        baseDamage: damageHint,
        worldId: String(worldId),
      });

      if (!result.ok) {
        return res.status(400).json({
          ok: false,
          refused: true,
          reason: result.error || result.reason || "hit_rejected",
          damage: 0,
        });
      }

      if (db) {
        try {
          db.prepare(`
            INSERT INTO world_events_log (id, city_id, user_id, trigger_id, action, context_json, fired_at)
            VALUES (lower(hex(randomblob(8))), ?, ?, 'combat:hit', ?, ?, datetime('now'))
          `).run(
            String(worldId),
            attackerId,
            String(result.damage),
            JSON.stringify({
              victimId,
              damage: result.damage,
              hpBefore: result.hpBefore,
              hpAfter: result.targetHealth,
              weapon: weaponKind,
            }),
          );
        } catch { /* optional */ }
      }

      return res.json({
        ok: true,
        authority: result.authority || "combat-hp-authority",
        damage: result.damage,
        hpBefore: result.hpBefore,
        hpAfter: result.targetHealth,
        targetHealth: result.targetHealth,
        targetMaxHealth: result.targetMaxHealth,
        targetKilled: !!result.targetKilled,
        refused: !!result.refused,
        reason: result.reason || undefined,
        weapon: result.weapon,
        targetId: result.targetId,
        attackerId: result.attackerId,
        worldId: result.worldId,
        momentum: result.momentum,
        severity: result.severity,
      });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/combat/death
  router.post("/death", kitchenGuestOrAuth, (req, res) => {
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

  // GET /api/combat/probe — auth-gated server-authority handshake for
  // Unity/WebGL/Editor. Does not resolve a hit; returns structured OK so
  // clients can prove the kitchen kernel is reachable + which bind paths
  // to use next (WS combat:attack or POST /hit / worlds combat/attack).
  // Offline Editor without this call still stays honest {ok:false, reason:'no_gateway'}.
  router.get("/probe", kitchenGuestOrAuth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const presence = typeof getUserPosition === "function" ? getUserPosition(userId) : null;
      res.json({
        ok: true,
        authority: "server",
        userId,
        presence: presence ? { cityId: presence.cityId ?? null, x: presence.x, y: presence.y, z: presence.z } : null,
        gateways: {
          godotWs: "/godot-ws",
          unityWs: "/unity-ws",
          combatEvt: "combat:attack",
          combatAck: "combat:attack:ack",
        },
        http: {
          hit: "POST /api/combat/hit",
          death: "POST /api/combat/death",
          recent: "GET /api/combat/recent",
          worldsAttack: "POST /api/worlds/:worldId/combat/attack",
          questsActive: "GET /api/worlds/:worldId/quests/active",
          questsInteract: "POST /api/quests/interact",
        },
        note: "WS combat:attack preferred when Connected; HTTP POST /api/combat/hit returns authoritative hpBefore/hpAfter; POST /api/quests/interact returns authored branching text. Probe is not a damage event.",
        ts: new Date().toISOString(),
      });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // GET /api/combat/recent — combat history feed.
  // Migration 066's damage_events table receives every validated hit
  // (3 dedicated indexes for {world_id, target_id, attacker_id} suggest
  // analytics queries were always intended), but pre-this-route nothing
  // read those rows back. Used by match-chronicle DTU mint, replay UI,
  // post-match recap, and the per-player combat-history lens. Filterable
  // by world, attacker, or target.
  //
  // Query params:
  //   worldId    — required if not filtering by attacker/target
  //   attackerId — optional
  //   targetId   — optional
  //   limit      — default 50, max 500
  router.get("/recent", kitchenGuestOrAuth, (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
      const { worldId, attackerId, targetId } = req.query;
      if (!worldId && !attackerId && !targetId) {
        return res.status(400).json({ ok: false, error: "must specify worldId, attackerId, or targetId" });
      }
      const where = [];
      const args = [];
      if (worldId)    { where.push("world_id = ?");    args.push(worldId); }
      if (attackerId) { where.push("attacker_id = ?"); args.push(attackerId); }
      if (targetId)   { where.push("target_id = ?");   args.push(targetId); }
      args.push(limit);
      const rows = db ? db.prepare(
        `SELECT id, world_id, attacker_id, attacker_type, target_id, target_type,
                skill_dtu_id, item_dtu_id, element, raw_damage, resistance_pct,
                final_damage, bar_used, bar_cost, status_effects, kill, occurred_at
           FROM damage_events
          WHERE ${where.join(" AND ")}
          ORDER BY occurred_at DESC
          LIMIT ?`,
      ).all(...args) : [];
      const parsed = rows.map((r) => ({
        ...r,
        statusEffects: (() => { try { return JSON.parse(r.status_effects); } catch { return []; } })(),
        kill: !!r.kill,
      }));
      res.json({ ok: true, events: parsed, count: parsed.length });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  return router;
}
