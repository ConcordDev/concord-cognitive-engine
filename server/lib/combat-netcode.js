/**
 * Combat Netcode — server-authoritative hit events broadcast to nearby peers.
 *
 * Up to now position was streamed but combat events were invisible: a player
 * could see another player's avatar but never their attacks, hits, or deaths.
 * This module is the missing peer-visibility layer for combat.
 *
 * Three event types over the existing socket.io channel:
 *
 *   combat:attack    — { attackerId, weapon, animation, direction, ts }
 *                      broadcast on swing-start so peers can play the
 *                      anticipation animation before the hit lands.
 *   combat:hit       — { attackerId, victimId, damage, isCrit, hitDirection,
 *                        magnitude, position, ts }
 *                      broadcast on damage application. Peers play
 *                      reaction + spatial SFX.
 *   combat:death     — { victimId, killerId, position, ts }
 *                      broadcast on HP<=0. Peers spawn the ragdoll.
 *
 * Spatial scoping: events are only delivered to users in the same city
 * within MAX_RADIUS metres of the action so a fight on the other side of
 * the map doesn't spam every player. The radius is chosen larger than
 * VIEW_DISTANCE so the event arrives before the avatars are rendered.
 *
 * Anti-cheat: hits are validated before broadcast.
 *   1. Attacker and victim must be in the same city.
 *   2. Distance attacker→victim must be within attacker's weapon reach.
 *   3. Attacker's last attack must be > minCooldown ago.
 *   4. Damage must be within [0, weaponMaxDamage * critMultiplier].
 *
 * Failed validation is logged and the event is dropped, never broadcast.
 *
 * ── DET-C batch 8 investigation (dead-event-listener sweep, 2026-07-23) ──
 * `combat:attack` and `combat:miss` were found genuinely orphaned, on both
 * sides, and NOT a detector scan-scope false positive like the Godot-only
 * events documented elsewhere in this sweep:
 *   - The REST routes that triggered these broadcasts (POST /api/combat/attack,
 *     /api/combat/hit — server/routes/combat.js, mounted at /api/combat in
 *     server.js) were never called by concord-frontend, concord-mobile, or
 *     world-lens-godot. Nothing exercised broadcastAttack()/broadcastHit()
 *     outside this module's own unit tests.
 *   - Even if they were called, broadcastAttack/broadcastHit call
 *     `REALTIME.io.to(...).emit(...)` directly rather than going through
 *     `realtimeEmit`/`emitToWorld`, so they'd bypass the Godot gateway's
 *     mirror (`_godotGatewayEmitter.emitToRoom`/`.broadcast`, wired inside
 *     those two helpers in server.js) even if a Godot client existed to
 *     receive them.
 *   - docs/GODOT_INTEGRATION.md independently confirmed the INBOUND
 *     direction was unfinished too ("`combat:attack` is NOT wired" for the
 *     Godot gateway's dispatch table) — consistent with this being a real,
 *     never-adopted parallel combat pipeline, not a rendering gap.
 * The LIVE combat path is a different mechanism entirely: the browser emits
 * `combat:attack` (client→server, the SAME event name, opposite direction —
 * see server.js's `socket.on("combat:attack", ...)`), which computes damage
 * via `cityPresence.applyAttack()` and broadcasts `combat:hit`/`combat:impact`
 * (server/lib/combat/impact-feel.js) — CombatInputController.tsx only ever
 * speaks that path.
 *
 * ── RESOLVED (dead-event-listener follow-up, 2026-07-24) ──────────────────
 * Wiring CombatInputController.tsx onto this REST+broadcast pipeline would
 * have meant building a second, redundant combat-input path alongside the
 * live socket one above — a real product/architecture decision, not a
 * one-file fix. Retiring the specifically-orphaned pieces was the honest
 * option that didn't require inventing a parallel system nobody asked for:
 * `broadcastAttack()` (the sole emitter of `combat:attack`) is removed, and
 * `broadcastHit()`'s i-frame "hit whiffs" branch no longer emits
 * `combat:miss` — it returns `{ delivered: 0, iframed: true }` honestly
 * instead of broadcasting an event with nobody listening. `POST
 * /api/combat/attack` (server/routes/combat.js) is removed with it, since
 * declaring an attack swing had no purpose once nothing broadcasts it and
 * the route was never called by any client anyway (see above). `broadcastHit`
 * (for the non-whiff `combat:hit` case), `broadcastDeath` (`combat:death`),
 * `POST /api/combat/hit`, `POST /api/combat/death`, and `GET
 * /api/combat/recent` are unchanged — out of scope for this fix (their event
 * names aren't orphaned: `combat:hit`/`combat:death` already have real
 * frontend consumers via the live pipeline above, and `/recent` is a genuine
 * read endpoint over `damage_events`, unrelated to this module's broadcasts).
 * `recordAttackSwing`/`validateHit` (pure, tested — see
 * server/tests/combat-state-netcode.test.js) are kept as-is.
 */

import logger from "../logger.js";
import { applyHitToState } from "./combat-state.js";

const MAX_BROADCAST_RADIUS_M = 1500;     // bigger than VIEW_DISTANCE
const MIN_ATTACK_COOLDOWN_MS = 200;       // hard floor; weapons may set higher
const DEFAULT_WEAPON_REACH_M = 3.0;       // melee
const RANGED_WEAPON_REACH_M  = 80.0;      // bow / firearm

const _lastAttackAt = new Map();          // attackerId -> ms timestamp

/**
 * Record an attack swing. Returns whether the attack is allowed (cooldown
 * gate). Caller broadcasts the attack only if allowed.
 */
export function recordAttackSwing(attackerId, { cooldownMs = MIN_ATTACK_COOLDOWN_MS } = {}) {
  const now = Date.now();
  const last = _lastAttackAt.get(attackerId) ?? 0;
  if (now - last < cooldownMs) return { allowed: false, reason: "cooldown_active", remainingMs: cooldownMs - (now - last) };
  _lastAttackAt.set(attackerId, now);
  return { allowed: true };
}

/**
 * Validate a hit before broadcast.
 *
 * @param {object} args
 * @param {object} args.attacker  - { id, position: {x,y,z}, cityId }
 * @param {object} args.victim    - { id, position: {x,y,z}, cityId }
 * @param {object} args.weapon    - { reach?, maxDamage?, ranged? }
 * @param {number} args.damage
 * @param {boolean} args.isCrit
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateHit({ attacker, victim, weapon = {}, damage, isCrit = false }) {
  if (!attacker?.id || !victim?.id) return { ok: false, reason: "missing_ids" };
  if (attacker.id === victim.id)     return { ok: false, reason: "self_target" };
  if (attacker.cityId !== victim.cityId) return { ok: false, reason: "cross_city" };

  const reach = weapon.reach ?? (weapon.ranged ? RANGED_WEAPON_REACH_M : DEFAULT_WEAPON_REACH_M);
  const maxDamage = weapon.maxDamage ?? 50;
  const critMul = isCrit ? 2.5 : 1.0;

  if (typeof damage !== "number" || damage < 0) return { ok: false, reason: "invalid_damage" };
  if (damage > maxDamage * critMul)             return { ok: false, reason: "damage_over_max" };

  if (attacker.position && victim.position) {
    const dx = attacker.position.x - victim.position.x;
    const dy = (attacker.position.y ?? 0) - (victim.position.y ?? 0);
    const dz = attacker.position.z - victim.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > reach + 0.5) return { ok: false, reason: "out_of_reach", dist, reach };
  }

  return { ok: true };
}

/**
 * Broadcast a hit event after server-side validation. Returns the number of
 * peers it was delivered to.
 */
export function broadcastHit(REALTIME, getNearbyUserIds, args) {
  if (!REALTIME?.ready || !REALTIME.io) return { delivered: 0 };
  const v = validateHit(args);
  if (!v.ok) {
    logger?.debug?.({ reason: v.reason, attacker: args.attacker?.id }, "combat_hit_rejected");
    return { delivered: 0, rejected: v.reason };
  }

  try {
    // Consult the victim's combat state — i-frames may zero damage, block
    // halves it, repeated hits exhaust poise and trigger stagger.
    const stateMod = applyHitToState(args.victim.id, {
      damage:    args.damage,
      isCrit:    !!args.isCrit,
      knockback: args.hitDirection
        ? { x: args.hitDirection.x * args.damage * 0.4, y: 0, z: args.hitDirection.z * args.damage * 0.4 }
        : null,
    });
    const finalDamage = Math.round(args.damage * stateMod.damageMul);

    if (stateMod.iframed) {
      // Hit whiffs — i-frames absorbed it, no damage applied. This used to
      // broadcast a 'combat:miss' event, but nothing anywhere ever
      // subscribed to it (dead-event-listener sweep) and this whole code
      // path is only reachable via POST /api/combat/hit, which no client
      // calls (see the module header's RESOLVED note) — so the broadcast
      // was firing into the void. Return honestly instead of fabricating a
      // "delivered" count for a broadcast that never happened.
      return { delivered: 0, iframed: true };
    }

    const targets = (getNearbyUserIds?.(args.attacker.cityId, args.victim.position, MAX_BROADCAST_RADIUS_M) ?? [])
      .filter(id => id !== args.attacker.id);
    const payload = {
      attackerId:    args.attacker.id,
      victimId:      args.victim.id,
      damage:        finalDamage,
      isCrit:        !!args.isCrit,
      blocked:       !!stateMod.blocked,
      staggered:     !!stateMod.staggered,
      hitDirection:  args.hitDirection ?? null,
      magnitude:     finalDamage,
      position:      args.victim.position,
      weapon:        args.weapon?.name ?? null,
      ts:            new Date().toISOString(),
    };
    // Always notify both attacker and victim (even if they're outside radius
    // — they're guaranteed to care about their own combat).
    const explicit = new Set(targets);
    explicit.add(args.attacker.id);
    explicit.add(args.victim.id);
    for (const uid of explicit) {
      REALTIME.io.to(`user:${uid}`).emit("combat:hit", payload);
    }
    return { delivered: explicit.size };
  } catch (err) {
    logger?.warn?.({ err: err.message }, "combat_netcode_broadcast_hit_failed");
    return { delivered: 0, error: err.message };
  }
}

/**
 * Broadcast a death. Peers handle ragdoll spawn + corpse rendering.
 */
export function broadcastDeath(REALTIME, getNearbyUserIds, { victimId, killerId = null, cityId, position }) {
  if (!REALTIME?.ready || !REALTIME.io) return { delivered: 0 };
  try {
    const targets = getNearbyUserIds?.(cityId, position, MAX_BROADCAST_RADIUS_M) ?? [];
    const payload = { victimId, killerId, position, ts: new Date().toISOString() };
    for (const uid of targets) {
      REALTIME.io.to(`user:${uid}`).emit("combat:death", payload);
    }
    return { delivered: targets.length };
  } catch (err) {
    logger?.warn?.({ err: err.message }, "combat_netcode_broadcast_death_failed");
    return { delivered: 0, error: err.message };
  }
}

/** Reset all per-user attack timestamps. Used by tests. */
export function _resetAttackCooldowns() { _lastAttackAt.clear(); }
