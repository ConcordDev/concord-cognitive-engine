// concord-frontend/lib/concordia/play-action.ts
//
// Living Society — the GENERAL action-animation dispatch. Any verb (chop/forage/
// forge/fish/cast/greet…) calls `playAction(verb)` and the avatar embodies it.
// Mirrors the combat path (`concordia:combat-anim`) but for the ~120 non-combat
// verbs. The descriptor is resolved here (never null — category fallback) and
// carried on the event so the bridge can fire juice/sfx/vfx without a re-resolve.
//
// "Adding a verb = a row" in action-biomechanics.ts; firing it = one call here.

import { resolveActionDescriptor, type ActionDescriptor } from './action-biomechanics';
import type { JuiceTrigger } from './juice';

export interface PlayActionOpts {
  /** entity to animate; defaults to the local player avatar (bridge resolves) */
  entityId?: string;
  /** mastery tier 1..5 — scales amplitude/anticipation */
  tier?: number;
  /** world position for the VFX burst (defaults to the actor's position) */
  pos?: { x: number; y?: number; z: number };
  /** body type for clip scaling */
  body?: 'slim' | 'average' | 'stocky' | 'tall';
  /** loop the action (sustained verbs: fishing line tension, forge hammer) */
  loop?: boolean;
}

/**
 * Map a descriptor's free-form juiceId onto a valid GameJuice trigger so a
 * visible feedback (shake/flash/fanfare) ALWAYS fires. Sound uses the raw sfxId.
 */
export function juiceTriggerFor(juiceId?: string): JuiceTrigger {
  const j = (juiceId || '').toLowerCase();
  if (j.startsWith('impact')) return 'damage';
  if (j === 'milestone' || j === 'cast') return 'milestone';
  if (j === 'coin' || j === 'craft_tick' || j === 'tech_tick' || j === 'water_pour') return 'discovery';
  if (j === 'soft' || j === 'soft_pluck' || j === 'soft_plant') return 'success';
  return 'success';
}

/**
 * Embody a verb on an avatar. Dispatches `concordia:action-anim`; the
 * AvatarSystem3D bridge plays the procedural/baked clip + fires juice/sfx/vfx.
 * Returns the resolved descriptor (handy for callers that want the ids).
 */
export function playAction(verb: string, opts: PlayActionOpts = {}): ActionDescriptor {
  const descriptor = resolveActionDescriptor(verb);
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('concordia:action-anim', {
        detail: { verb, descriptor, ...opts },
      }));
    } catch { /* SSR / no window */ }
  }
  return descriptor;
}

/**
 * Convenience for station/labor UI: embody the verb on the LOCAL player and
 * anchor the VFX burst at the player's live world position (set on
 * `window.__concordiaPlayerPos` by AvatarSystem3D). Falls back to the bridge's
 * default position when the player position isn't known yet. This is the one
 * call a station overlay makes on a successful action so "doing" moves the body.
 */
export function playActionAtPlayer(verb: string, opts: PlayActionOpts = {}): ActionDescriptor {
  let pos = opts.pos;
  if (!pos && typeof window !== 'undefined') {
    const p = (window as { __concordiaPlayerPos?: { x: number; y?: number; z: number } }).__concordiaPlayerPos;
    if (p) pos = { x: p.x, y: p.y ?? 1, z: p.z };
  }
  return playAction(verb, { ...opts, pos });
}
