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
 * Broadcast an attack swing event to nearby peers.
 *
 * @param {object} REALTIME - { ready, io } from server.js
 * @param {Function} getNearbyUserIds - (cityId, position, radius) => string[]
 */
export function broadcastAttack(REALTIME, getNearbyUserIds, args) {
  if (!REALTIME?.ready || !REALTIME.io) return { delivered: 0 };
  try {
    const targets = (getNearbyUserIds?.(args.cityId, args.position, MAX_BROADCAST_RADIUS_M) ?? []).filter(id => id !== args.attackerId);
    const payload = {
      attackerId: args.attackerId,
      weapon:     args.weapon ?? "fist",
      animation:  args.animation ?? "swing",
      direction:  args.direction ?? null,
      position:   args.position,
      ts:         new Date().toISOString(),
    };
    for (const uid of targets) {
      REALTIME.io.to(`user:${uid}`).emit("combat:attack", payload);
    }
    return { delivered: targets.length };
  } catch (err) {
    logger?.warn?.({ err: err.message }, "combat_netcode_broadcast_attack_failed");
    return { delivered: 0, error: err.message };
  }
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
      // Hit whiffs: deliver a "hit:miss" event for FX without applying damage.
      const targets = (getNearbyUserIds?.(args.attacker.cityId, args.victim.position, MAX_BROADCAST_RADIUS_M) ?? []);
      const payload = { attackerId: args.attacker.id, victimId: args.victim.id, missed: true, ts: new Date().toISOString() };
      for (const uid of new Set([args.attacker.id, args.victim.id, ...targets])) {
        REALTIME.io.to(`user:${uid}`).emit("combat:miss", payload);
      }
      return { delivered: targets.length, iframed: true };
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
