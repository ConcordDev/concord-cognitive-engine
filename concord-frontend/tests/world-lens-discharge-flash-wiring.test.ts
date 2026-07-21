// Stability audit (2026-07-21) — discharge flash ("the gun/staff/wand
// visibly reacts when the wielder attacks") wiring. AvatarSystem3D.tsx is
// too large/heavy (refs, THREE.js scene graph, animation mixers) to
// mount and render in jsdom — same exemption this repo already applies
// to every other file in components/world-lens/ (see
// scripts/check-diff-coverage.mjs's SKIP array and
// public/models/CREDITS.md's own note on this). The underlying pure
// logic (getDischargeWorldPosition, per-archetype discharge points) has
// real behavioral coverage in tests/lib/weapon-archetypes-real-asset.test.ts;
// this file source-pins that AvatarSystem3D.tsx's handleCombatAnim
// actually calls into it on the local player's attack trigger, rather
// than the wiring silently rotting unnoticed (the exact failure mode
// found and fixed this same session for the require()-based carry-item
// wiring in enhanced-avatar-builder.ts).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '..', 'components/world-lens/AvatarSystem3D.tsx'),
  'utf8'
);

describe('AvatarSystem3D.tsx — discharge flash wiring', () => {
  it('imports getDischargeWorldPosition as a static import (not a fragile runtime require)', () => {
    expect(src).toMatch(/import \{ getDischargeWorldPosition, type WeaponArchetype \} from '@\/lib\/concordia\/weapon-archetypes';/);
  });

  it('handleCombatAnim checks all 4 discharge-capable archetypes by their real weapon_<archetype> group name', () => {
    expect(src).toMatch(/const DISCHARGE_ARCHETYPES: WeaponArchetype\[\] = \['firearm_pistol', 'firearm_rifle', 'staff', 'wand'\];/);
    expect(src).toMatch(/`weapon_\$\{archetype\}`/);
  });

  it('looks up the weapon on playerMeshRef.current (the local player\'s real built avatar group)', () => {
    expect(src).toMatch(/playerMeshRef\.current as InstanceType<typeof import\('three'\)\.Group>;\s*\n\s*let dischargeWeapon/);
  });

  it('calls getDischargeWorldPosition on the found weapon, not a hardcoded/guessed position', () => {
    expect(src).toMatch(/getDischargeWorldPosition\(dischargeWeapon as unknown as Parameters<typeof getDischargeWorldPosition>\[0\]\)/);
  });

  it('dispatches the real, already-mounted concordia:particle-effect event (world-vfx-bridge.ts), not a new ad-hoc VFX channel', () => {
    expect(src).toMatch(/new CustomEvent\('concordia:particle-effect', \{\s*\n\s*detail: \{ type: vfxType, position: \{ x: pos\.x, y: pos\.y, z: pos\.z \}, intensity: 1 \},/);
  });

  it('maps firearms to the "flash" preset and staff/wand enchantment to element-flavored presets, falling back to "cast"', () => {
    expect(src).toMatch(/const isFirearm = archetype === 'firearm_pistol' \|\| archetype === 'firearm_rifle';/);
    expect(src).toMatch(/\? 'flash'/);
    expect(src).toMatch(/enchantment === 'fire' \? 'flame'/);
    expect(src).toMatch(/enchantment === 'frost' \? 'frost'/);
    expect(src).toMatch(/enchantment === 'lightning' \? 'spark'/);
    expect(src).toMatch(/enchantment === 'arcane' \? 'arcane'/);
    expect(src).toMatch(/: 'cast';/);
  });

  it('is gated to the local player + an attack-prefixed animation, matching the existing weapon-trail trigger scope exactly', () => {
    expect(src).toMatch(/detail\.entityId === playerAvatar\.id && detail\.animation\.startsWith\('attack'\) && playerMeshRef\.current/);
  });

  it('is wrapped in try/catch so a discharge-flash failure can never block the real combat animation it sits next to', () => {
    const idx = src.indexOf('Discharge flash — the visual companion');
    expect(idx).toBeGreaterThan(-1);
    const nearby = src.slice(idx, idx + 3000);
    expect(nearby).toMatch(/try \{/);
    expect(nearby).toMatch(/catch \{ \/\* discharge flash is best-effort cosmetic, never block combat anim \*\/ \}/);
  });

  it('sits immediately after (not replacing) the existing weapon-trail block, preserving that behavior', () => {
    const trailIdx = src.indexOf("weaponTrailRef.current.setActive(true);");
    const flashIdx = src.indexOf('Discharge flash — the visual companion');
    expect(trailIdx).toBeGreaterThan(-1);
    expect(flashIdx).toBeGreaterThan(trailIdx);
    expect(flashIdx - trailIdx).toBeLessThan(500); // adjacent, not scattered elsewhere in this 2900+ line file
  });
});
