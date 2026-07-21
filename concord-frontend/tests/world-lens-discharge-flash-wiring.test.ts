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
  it('imports getDischargeWorldPosition, getWeaponTipWorldPosition, and the shared DISCHARGE_ARCHETYPES list as static imports (not a fragile runtime require)', () => {
    expect(src).toMatch(/import \{ getDischargeWorldPosition, getWeaponTipWorldPosition, DISCHARGE_ARCHETYPES, type WeaponArchetype \} from '@\/lib\/concordia\/weapon-archetypes';/);
  });

  it('handleCombatAnim checks all 4 discharge-capable archetypes (imported from weapon-archetypes.ts, not a second hardcoded copy) by their real weapon_<archetype> group name', () => {
    expect(src).not.toMatch(/const DISCHARGE_ARCHETYPES: WeaponArchetype\[\]/); // no local shadow copy
    expect(src).toMatch(/for \(const archetype of DISCHARGE_ARCHETYPES\) \{/);
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
    const nearby = src.slice(idx, idx + 4500); // widened for the ranged-combat tracer block added inline
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

// Stability audit (2026-07-21) — the weapon-swing trail fix. Previously
// this per-frame block sampled `userData.boneMap.get('rightHand')`, a
// bone map ONLY the legacy procedural avatar builder sets — but the real
// local player is always built via the enhanced-avatar path (see
// createAvatarMeshSmart's `wantEnhanced` a few hundred lines up, always
// true when `isLocalPlayer` is set), which never sets that boneMap. The
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
