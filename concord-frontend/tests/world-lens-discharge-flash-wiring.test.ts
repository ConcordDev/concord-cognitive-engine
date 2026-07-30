// Stability audit (2026-07-21) — discharge flash ("the gun/staff/wand
// visibly reacts when the wielder attacks") wiring. AvatarSystem3D.tsx is
// too large/heavy (refs, THREE.js scene graph, animation mixers) to
// mount and render in jsdom — same exemption this repo already applies
// to every other file in components/world-lens/ (see
// scripts/check-diff-coverage.mjs's SKIP array and
// public/models/CREDITS.md's own note on this).
//
// The underlying logic (weapon lookup by real `weapon_<archetype>` group
// name, the firearm/enchantment → VFX-preset mapping, the real
// `concordia:particle-effect` dispatch, and the local-player/attack-prefix
// gate) has since been extracted out of `handleCombatAnim`'s inline
// closure into three standalone exported functions —
// `resolveDischargeVfx`, `emitDischargeVfx`, `shouldEmitDischargeVfx` —
// specifically so this file can drive the REAL production logic directly
// (real THREE.Group/Object3D graphs, a real `window.dispatchEvent` spy)
// instead of regex-matching source text.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveDischargeVfx,
  emitDischargeVfx,
  shouldEmitDischargeVfx,
} from '@/components/world-lens/AvatarSystem3D';
// Real module — the same DISCHARGE_ARCHETYPES list AvatarSystem3D.tsx
// imports and loops over (not a locally re-declared copy in this test).
import { DISCHARGE_ARCHETYPES } from '@/lib/concordia/weapon-archetypes';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '..', 'components/world-lens/AvatarSystem3D.tsx'),
  'utf8'
);

/** Builds a minimal real THREE.Group standing in for a built player avatar,
 *  with one named weapon child carrying the userData a real createWeapon()
 *  call would stamp (dischargeLocal + archetype + optional enchantment). */
function buildPlayerGroupWithWeapon(
  weaponName: string,
  userData: Record<string, unknown>,
): THREE.Group {
  const playerGroup = new THREE.Group();
  const weapon = new THREE.Group();
  weapon.name = weaponName;
  weapon.userData = { dischargeLocal: { x: 0, y: 1.2, z: 0.5 }, ...userData };
  playerGroup.add(weapon);
  playerGroup.position.set(10, 0, 20);
  playerGroup.updateWorldMatrix(true, false);
  return playerGroup;
}

describe('AvatarSystem3D.tsx — discharge flash wiring (resolveDischargeVfx)', () => {
  it('finds the equipped weapon by its real weapon_<archetype> group name for every one of the imported DISCHARGE_ARCHETYPES (not a locally hardcoded copy)', () => {
    for (const archetype of DISCHARGE_ARCHETYPES) {
      const playerGroup = buildPlayerGroupWithWeapon(`weapon_${archetype}`, { archetype });
      const vfx = resolveDischargeVfx(playerGroup);
      expect(vfx).not.toBeNull();
      expect(vfx!.weapon.name).toBe(`weapon_${archetype}`);
    }
  });

  it('does not fire for a melee-only archetype name that is not one of the 4 discharge-capable archetypes', () => {
    // shortsword is a real weapon archetype but not discharge-capable —
    // createWeapon() never sets a dischargeLocal point for it, so it must
    // never be found by the discharge lookup even if named weapon_shortsword.
    expect(DISCHARGE_ARCHETYPES).not.toContain('shortsword');
    const playerGroup = buildPlayerGroupWithWeapon('weapon_shortsword', { archetype: 'shortsword' });
    expect(resolveDischargeVfx(playerGroup)).toBeNull();
  });

  it('looks up the weapon on the real built avatar group via THREE.Object3D.getObjectByName, using the REAL getDischargeWorldPosition transform (not a hardcoded/guessed position)', () => {
    const playerGroup = buildPlayerGroupWithWeapon('weapon_firearm_pistol', { archetype: 'firearm_pistol' });
    const weapon = playerGroup.getObjectByName('weapon_firearm_pistol')!;
    weapon.position.set(0.2, 1.4, 0.1); // local offset from the player group origin

    const vfx = resolveDischargeVfx(playerGroup);

    expect(vfx).not.toBeNull();
    // The real transform: player group is at (10,0,20); weapon local offset
    // (0.2,1.4,0.1); dischargeLocal (0,1.2,0.5) further offset from the
    // weapon. The returned position must be the REAL world-space result of
    // that chain, not the raw dischargeLocal values (0,1.2,0.5) and not the
    // raw weapon offset alone.
    expect(vfx!.position).not.toEqual({ x: 0, y: 1.2, z: 0.5 });
    expect(vfx!.position.x).toBeCloseTo(10 + 0.2 + 0, 5);
    expect(vfx!.position.y).toBeCloseTo(0 + 1.4 + 1.2, 5);
    expect(vfx!.position.z).toBeCloseTo(20 + 0.1 + 0.5, 5);
  });

  it('returns null when the group has no discharge-capable weapon at all, or the player group is missing', () => {
    expect(resolveDischargeVfx(null)).toBeNull();
    expect(resolveDischargeVfx(new THREE.Group())).toBeNull();
  });

  it('maps firearms to the "flash" preset, staff/wand enchantment to element-flavored presets, and falls back to "cast"', () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['weapon_firearm_pistol', { archetype: 'firearm_pistol' }, 'flash'],
      ['weapon_firearm_rifle', { archetype: 'firearm_rifle' }, 'flash'],
      ['weapon_staff', { archetype: 'staff', enchantment: 'fire' }, 'flame'],
      ['weapon_staff', { archetype: 'staff', enchantment: 'frost' }, 'frost'],
      ['weapon_wand', { archetype: 'wand', enchantment: 'lightning' }, 'spark'],
      ['weapon_wand', { archetype: 'wand', enchantment: 'arcane' }, 'arcane'],
      ['weapon_staff', { archetype: 'staff' }, 'cast'],
    ];
    for (const [name, userData, expected] of cases) {
      const playerGroup = buildPlayerGroupWithWeapon(name, userData);
      const vfx = resolveDischargeVfx(playerGroup);
      expect(vfx?.type).toBe(expected);
    }
  });
});

describe('AvatarSystem3D.tsx — discharge flash wiring (emitDischargeVfx dispatch)', () => {
  let handler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    handler = vi.fn();
    window.addEventListener('concordia:particle-effect', handler);
  });

  afterEach(() => {
    window.removeEventListener('concordia:particle-effect', handler);
  });

  it('dispatches the real, already-mounted concordia:particle-effect CustomEvent (world-vfx-bridge.ts), not a new ad-hoc VFX channel', () => {
    const playerGroup = buildPlayerGroupWithWeapon('weapon_firearm_rifle', { archetype: 'firearm_rifle' });

    const vfx = emitDischargeVfx(playerGroup);

    expect(vfx).not.toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('concordia:particle-effect');
    expect(event.detail).toEqual({ type: 'flash', position: vfx!.position, intensity: 1 });
  });

  it('does not dispatch anything when there is no discharge-capable weapon equipped', () => {
    const playerGroup = buildPlayerGroupWithWeapon('weapon_shortsword', { archetype: 'shortsword' });

    const vfx = emitDischargeVfx(playerGroup);

    expect(vfx).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('AvatarSystem3D.tsx — discharge flash wiring (shouldEmitDischargeVfx gate)', () => {
  it('is gated to the local player + an attack-prefixed animation, matching the existing weapon-trail trigger scope (minus the "kick" allowance the trail block additionally permits)', () => {
    expect(shouldEmitDischargeVfx({ entityId: 'player-1', animation: 'attack_light' }, 'player-1', true)).toBe(true);
    expect(shouldEmitDischargeVfx({ entityId: 'player-1', animation: 'attack_heavy' }, 'player-1', true)).toBe(true);
    // Wrong entity (an NPC or another player, not the local player).
    expect(shouldEmitDischargeVfx({ entityId: 'npc-42', animation: 'attack_light' }, 'player-1', true)).toBe(false);
    // Non-attack animation — including 'kick', which the weapon-TRAIL block
    // allows but discharge does not.
    expect(shouldEmitDischargeVfx({ entityId: 'player-1', animation: 'kick' }, 'player-1', true)).toBe(false);
    expect(shouldEmitDischargeVfx({ entityId: 'player-1', animation: 'idle' }, 'player-1', true)).toBe(false);
    // No built player mesh yet.
    expect(shouldEmitDischargeVfx({ entityId: 'player-1', animation: 'attack_light' }, 'player-1', false)).toBe(false);
  });
});

describe('AvatarSystem3D.tsx — discharge flash: best-effort, never blocks combat anim', () => {
  it('is wrapped in try/catch so a discharge-flash failure can never block the real combat animation it sits next to', () => {
    const idx = src.indexOf('Discharge flash — the visual companion');
    expect(idx).toBeGreaterThan(-1);
    const nearby = src.slice(idx, idx + 3500);
    expect(nearby).toMatch(/try \{/);
    expect(nearby).toMatch(/catch \{ \/\* discharge flash is best-effort cosmetic, never block combat anim \*\/ \}/);
  });

  it('sits immediately after (not replacing) the existing weapon-trail block, preserving that behavior', () => {
    const trailIdx = src.indexOf('weaponTrailRef.current.setActive(true);');
    const flashIdx = src.indexOf('Discharge flash — the visual companion');
    expect(trailIdx).toBeGreaterThan(-1);
    expect(flashIdx).toBeGreaterThan(trailIdx);
    expect(flashIdx - trailIdx).toBeLessThan(500); // adjacent, not scattered elsewhere in this 3000+ line file
  });
});

// Stability audit (2026-07-21) — the weapon-swing trail fix. Previously
// this per-frame block sampled `userData.boneMap.get('rightHand')`, a
// bone map ONLY the legacy procedural avatar builder sets — but the local
// player never used that builder even before R7's hero-mesh change (see
// createAvatarMeshSmart's `wantEnhanced` a few hundred lines up, always
// true), so it never set that boneMap either way. The
// .sample() call site was real (my own earlier claim that it was "never
// invoked anywhere" was wrong and is corrected in CREDITS.md), but
// `tipBone` silently resolved to undefined for the one avatar this block
// actually serves, so the trail never received a real position and
// stayed invisible — same visible outcome, different root cause than
// first reported.
describe('AvatarSystem3D.tsx — weapon-trail tip-position fix', () => {
  it('prefers the equipped weapon\'s real tip position (getWeaponTipWorldPosition) over the boneMap lookup', () => {
    const idx = src.indexOf('I2 — weapon trail: sample the equipped weapon');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 4000);
    expect(block).toMatch(/for \(const archetype of ALL_WEAPON_ARCHETYPES\) \{/);
    expect(block).toMatch(/getWeaponTipWorldPosition\(found as unknown as Parameters<typeof getWeaponTipWorldPosition>\[0\]\)/);
  });

  it('keeps the old boneMap lookup as a fallback (pure improvement, not a narrowing) rather than deleting it outright', () => {
    const idx = src.indexOf('I2 — weapon trail: sample the equipped weapon');
    const block = src.slice(idx, idx + 4000);
    expect(block).toMatch(/if \(!tipWorldPos\) \{/);
    expect(block).toMatch(/pMesh\.userData\?\.boneMap\?\.get\('rightHand'\)/);
  });

  it('scans ALL_WEAPON_ARCHETYPES (all 16), not just the 4 discharge-capable ones, so melee weapons get a trail too', () => {
    expect(src).toMatch(/const ALL_WEAPON_ARCHETYPES: WeaponArchetype\[\] = \[\s*\n\s*'shortsword', 'longsword', 'axe', 'mace', 'dagger', 'club',\s*\n\s*'scimitar', 'greatsword', 'halberd', 'spear', 'bow', 'crossbow',\s*\n\s*'firearm_pistol', 'firearm_rifle', 'staff', 'wand',\s*\n\s*\];/);
  });

  it('still calls trail.sample() unconditionally-per-found-tip and trail.tick() every frame (unchanged cadence)', () => {
    const idx = src.indexOf('I2 — weapon trail: sample the equipped weapon');
    const block = src.slice(idx, idx + 4000);
    expect(block).toMatch(/trail\.sample\(\{ x: tipWorldPos\.x, y: tipWorldPos\.y, z: tipWorldPos\.z \}, now \/ 1000\)/);
    expect(block).toMatch(/trail\?\.tick\(now \/ 1000\);/);
  });
});
