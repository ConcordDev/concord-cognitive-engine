/**
 * Combat State — knockback / stagger / poise / iframe authority.
 *
 * The audit flagged combat at 3/10 because there was no real-time feedback
 * loop — VATS UI existed, hits were broadcast (combat-netcode), but there
 * was no STATE: no knockback when struck, no stagger window, no poise
 * meter, no invulnerability frames. This module is that state.
 *
 * Per-actor combat state is kept server-side so peers see consistent
 * outcomes. Each actor has:
 *   - poise:        0..100; high poise resists stagger; depletes per hit
 *   - staggerUntil: ms epoch; while > now actor is interruptible
 *   - knockbackVel: vector applied to next position update
 *   - iframeUntil:  ms epoch; while > now incoming hits whiff
 *   - blockUntil:   ms epoch; while > now incoming damage halves
 *
 * The combat-netcode validateHit() is extended to consult this state and
 * adjust damage / reject the hit when iframes are active.
 *
 * F1.3 — a live telegraph peril on the defender means i-frames from the
 * WRONG counter do not whiff the hit. noteIncomingPeril stamps the window;
 * grantIFrames records which defense was used.
 */

import { counterNegates } from "./combat/telegraph-peril.js";

const _state = new Map(); // actorId -> { poise, ... }

const POISE_MAX               = 100;
const POISE_REGEN_PER_SEC     = 12;     // poise recovers when not hit
const POISE_DAMAGE_PER_HIT    = 22;     // base poise damage
const STAGGER_DURATION_MS     = 700;    // when poise hits 0
const KNOCKBACK_DECAY_PER_TICK = 0.85;
const KNOCKBACK_MIN_VEL       = 0.2;

function _ensure(actorId) {
  let s = _state.get(actorId);
  if (!s) {
    s = {
      poise: POISE_MAX,
      staggerUntil: 0,
      knockbackVel: { x: 0, y: 0, z: 0 },
      iframeUntil: 0,
      blockUntil: 0,
      perilKind: null,
      perilUntil: 0,
      defenseAction: "dodge",
      lastUpdate: Date.now(),
    };
    _state.set(actorId, s);
  }
  return s;
}

/** Apply a hit's effect on the actor's combat state. Returns the modifier
 *  the resolver should apply: damageMul, staggered, blocked. */
export function applyHitToState(actorId, { damage = 0, isCrit = false, knockback = null }) {
  const s = _ensure(actorId);
  const now = Date.now();

  if (now < s.iframeUntil) {
    const perilLive = s.perilKind && now < (s.perilUntil || 0);
    if (!perilLive || counterNegates(s.perilKind, s.defenseAction || "dodge")) {
      return { damageMul: 0, staggered: false, blocked: false, iframed: true };
    }
    // Wrong counter during a perilous tell — i-frames do not save you.
  }

  let damageMul = 1.0;
  let blocked = false;
  if (now < s.blockUntil) {
    damageMul = 0.5;
    blocked   = true;
  }

  // Poise: heavy hits deplete more, crits drain faster
  const poiseDmg = POISE_DAMAGE_PER_HIT * (damage / 25) * (isCrit ? 1.5 : 1.0);
  s.poise = Math.max(0, s.poise - poiseDmg);
  let staggered = false;
  if (s.poise <= 0) {
    s.staggerUntil = now + STAGGER_DURATION_MS;
    s.poise = POISE_MAX * 0.4; // partial reset so the actor isn't permastaggered
    staggered = true;
  }

  if (knockback) {
    s.knockbackVel = { x: knockback.x ?? 0, y: knockback.y ?? 0, z: knockback.z ?? 0 };
  }

  s.lastUpdate = now;
  return { damageMul, staggered, blocked, iframed: false };
}

/** Per-tick maintenance — regen poise when not hit, decay knockback. */
export function tickCombatState(now = Date.now()) {
  for (const [id, s] of _state) {
    const dtSec = (now - s.lastUpdate) / 1000;
    if (s.poise < POISE_MAX) {
      s.poise = Math.min(POISE_MAX, s.poise + POISE_REGEN_PER_SEC * dtSec);
    }
    if (Math.hypot(s.knockbackVel.x, s.knockbackVel.y, s.knockbackVel.z) > KNOCKBACK_MIN_VEL) {
      s.knockbackVel.x *= KNOCKBACK_DECAY_PER_TICK;
      s.knockbackVel.y *= KNOCKBACK_DECAY_PER_TICK;
      s.knockbackVel.z *= KNOCKBACK_DECAY_PER_TICK;
    } else {
      s.knockbackVel = { x: 0, y: 0, z: 0 };
    }
    s.lastUpdate = now;
  }
}

/** Read a snapshot of an actor's combat state. */
export function getCombatState(actorId) {
  const s = _ensure(actorId);
  const now = Date.now();
  return {
    poise:       s.poise,
    poiseMax:    POISE_MAX,
    staggered:   now < s.staggerUntil,
    iframed:     now < s.iframeUntil,
    blocking:    now < s.blockUntil,
    knockbackVel: { ...s.knockbackVel },
  };
}

/** Stamp a typed telegraph on the defender so the next hit can gate i-frames. */
export function noteIncomingPeril(actorId, perilKind, durationMs = 400) {
  if (!actorId || !perilKind) return;
  const s = _ensure(actorId);
  s.perilKind = perilKind;
  s.perilUntil = Date.now() + Math.max(80, Number(durationMs) || 400);
}

/** Set the actor's i-frame window (e.g. just after a successful dodge). */
export function grantIFrames(actorId, durationMs = 350, defenseAction = "dodge") {
  const s = _ensure(actorId);
  s.iframeUntil = Math.max(s.iframeUntil, Date.now() + durationMs);
  const a = String(defenseAction || "dodge").toLowerCase();
  s.defenseAction = ["jump", "break", "block", "parry", "dodge"].includes(a) ? a : "dodge";
}

/** Set the actor's block window. Block reduces damage 50% and prevents stagger. */
export function setBlock(actorId, durationMs = 600) {
  const s = _ensure(actorId);
  s.blockUntil = Math.max(s.blockUntil, Date.now() + durationMs);
}

/** Reset state (usually on respawn or zone change). */
export function resetCombatState(actorId) {
  _state.delete(actorId);
}

export const COMBAT_STATE_CONSTANTS = Object.freeze({
  POISE_MAX,
  POISE_REGEN_PER_SEC,
  STAGGER_DURATION_MS,
});
