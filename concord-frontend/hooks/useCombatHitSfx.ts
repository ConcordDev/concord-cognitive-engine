'use client';

/**
 * useCombatHitSfx — Wave 1 / T1.4. Listens to combat:hit-sfx socket events
 * and dispatches a per-category SFX through the global SoundscapeEngine.
 *
 * Picks SFX in this order:
 *   1. Element overlay (fire / ice / lightning / holy / ...) if present
 *   2. Weapon category (firearm / energy / melee_blade_2h / ...)
 *   3. Fallback: hit-light
 *
 * Mount once near the top of the world lens. The hook self-detaches on
 * unmount.
 */

import { useEffect } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { useSoundscape } from '@/components/world-lens/SoundscapeEngine';

interface HitSfxPayload {
  worldId: string;
  attackerId: string;
  targetId: string;
  weaponClass: string | null;
  weaponCategory: string | null;
  element: string | null;
  isCrit: boolean;
  damage: number;
  position: { x: number; y: number; z: number };
}

const CATEGORY_TO_SFX: Record<string, string> = {
  firearm:           'hit-firearm',
  energy:            'hit-energy',
  heavy_explosive:   'hit-heavy-explosive',
  projectile:        'hit-projectile',
  melee_blade_1h:    'hit-melee-blade-1h',
  melee_blade_2h:    'hit-melee-blade-2h',
  melee_polearm:     'hit-melee-polearm',
  melee_blunt_1h:    'hit-melee-blunt-1h',
  melee_blunt_2h:    'hit-melee-blunt-2h',
  melee_exotic:      'hit-melee-exotic',
  fist:              'hit-fist',
  focus:             'hit-focus',
  shield:            'hit-fist',          // shield bash → fist-equivalent
  cyberware:         'hit-cyberware',
  hybrid:            'hit-hybrid',
  amorphous:         'hit-focus',         // amorphous casts feel magical
};

const ELEMENT_TO_SFX: Record<string, string> = {
  fire:      'hit-element-fire',
  ice:       'hit-element-ice',
  lightning: 'hit-element-lightning',
  water:     'hit-element-water',
  earth:     'hit-element-earth',
  wind:      'hit-element-wind',
  holy:      'hit-element-holy',
  light:     'hit-element-holy',
  dark:      'hit-element-dark',
  shadow:    'hit-element-dark',
  void:      'hit-element-void',
  bio:       'hit-element-bio',
  poison:    'hit-element-poison',
  arcane:    'hit-element-arcane',
  psychic:   'hit-element-psychic',
};

function pickSfx(payload: HitSfxPayload): string {
  if (payload.element && ELEMENT_TO_SFX[payload.element]) return ELEMENT_TO_SFX[payload.element];
  if (payload.weaponCategory && CATEGORY_TO_SFX[payload.weaponCategory]) return CATEGORY_TO_SFX[payload.weaponCategory];
  return 'hit-light';
}

export function useCombatHitSfx(): void {
  const { playSpatialSFX, triggerSFX } = useSoundscape();

  useEffect(() => {
    const unsub = subscribe<HitSfxPayload>('combat:hit-sfx', (payload) => {
      if (!payload) return;
      const sfx = pickSfx(payload);
      if (payload.position) playSpatialSFX(sfx, payload.position);
      else triggerSFX(sfx);
      // Crit overlay: layer the hit-crit transient on top.
      if (payload.isCrit) triggerSFX('hit-crit');
    });
    return () => { try { unsub(); } catch { /* ok */ } };
  }, [playSpatialSFX, triggerSFX]);
}
