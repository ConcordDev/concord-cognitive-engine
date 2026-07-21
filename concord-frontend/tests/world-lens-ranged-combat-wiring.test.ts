// Ranged combat wiring — fire-input binding, projectile tracer, and the
// crosshair aim-resolution bridge between ConcordiaScene (owns the THREE.js
// camera/scene) and CombatInputController (owns keyboard/mouse input, no
// scene access). Same source-pinning approach this session already
// established for AvatarSystem3D.tsx (see
// tests/world-lens-discharge-flash-wiring.test.ts's own header comment) —
// these files mount real Three.js scene graphs / heavy refs that jsdom
// can't render, so the pure logic (projectile-tracer.ts, camera-look-state.ts)
// gets real behavioral coverage elsewhere and this file proves the wiring
// between components is actually present, not silently dropped.
//
// Server-side pieces (combat-limits.js#clampAttackRange, attack-cooldown.js's
// 'fire' class, server.js's socket handler) have real node:test behavioral
// coverage at server/tests/socket-combat-range-cap.test.js and
// server/tests/combat-cooldown-per-action.test.js — not duplicated here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function readSrc(relPath: string): string {
  return readFileSync(path.resolve(__dirname, '..', relPath), 'utf8');
}

const combatInput = readSrc('components/world-lens/CombatInputController.tsx');
const concordiaScene = readSrc('components/world-lens/ConcordiaScene.tsx');
const avatarSystem = readSrc('components/world-lens/AvatarSystem3D.tsx');
const cameraLookState = readSrc('lib/world-lens/camera-look-state.ts');

describe('camera-look-state.ts — aim-hit bridge fields', () => {
  it('exposes aimHitPoint and aimHitEntityId, both null by default', () => {
    expect(cameraLookState).toMatch(/aimHitPoint:\s*\{ x: number; y: number; z: number \} \| null;/);
    expect(cameraLookState).toMatch(/aimHitEntityId:\s*string \| null;/);
    expect(cameraLookState).toMatch(/aimHitPoint:\s*null,/);
    expect(cameraLookState).toMatch(/aimHitEntityId:\s*null,/);
  });
});

describe('ConcordiaScene.tsx — crosshair aim raycast', () => {
  it('throttles the aim raycast to ~20Hz via aimRaycastLastRef', () => {
    expect(concordiaScene).toMatch(/const aimRaycastLastRef = useRef<number>\(0\);/);
    expect(concordiaScene).toMatch(/_nowAim - aimRaycastLastRef\.current > 50/);
  });

  it('only runs in player-tracking camera modes (follow/first-person/interior)', () => {
    const idx = concordiaScene.indexOf('crosshair aim raycast');
    expect(idx).toBeGreaterThan(-1);
    const block = concordiaScene.slice(idx, idx + 3000);
    expect(block).toMatch(/mode === 'follow' \|\| mode === 'first-person' \|\| mode === 'interior'/);
  });

  it('raycasts from screen-center (NDC 0,0), not the mouse position', () => {
    const idx = concordiaScene.indexOf('crosshair aim raycast');
    const block = concordiaScene.slice(idx, idx + 3000);
    expect(block).toMatch(/rc\.setFromCamera\(new THREE\.Vector2\(0, 0\), camera/);
  });

  it('resolves an NPC/other-player hit into aimHitEntityId, falls back to buildings/terrain, then a far point along the ray', () => {
    const idx = concordiaScene.indexOf('crosshair aim raycast');
    const block = concordiaScene.slice(idx, idx + 4000);
    expect(block).toMatch(/hitEntityId = ud\.avatarId;/);
    expect(block).toMatch(/layersRef\.current\['buildings'\], layersRef\.current\['terrain'\]/);
    expect(block).toMatch(/rc\.ray\.origin\.clone\(\)\.add\(rc\.ray\.direction\.clone\(\)\.multiplyScalar\(AIM_MAX_RANGE_M\)\)/);
    expect(block).toMatch(/cameraLookState\.aimHitPoint = hitPoint;/);
    expect(block).toMatch(/cameraLookState\.aimHitEntityId = hitEntityId;/);
  });

  it('caps aim raycast range at 80m, mirroring the server COMBAT_MAX_REACH_M ceiling', () => {
    const idx = concordiaScene.indexOf('crosshair aim raycast');
    const block = concordiaScene.slice(idx, idx + 3000);
    expect(block).toMatch(/const AIM_MAX_RANGE_M = 80;/);
  });
});

describe('AvatarSystem3D.tsx — firearm discharge fires a projectile tracer', () => {
  it('preloads createProjectileTracerSystem alongside the weapon-trail factory', () => {
    expect(avatarSystem).toMatch(/const \{ createProjectileTracerSystem: _createProjectileTracer \} = await import\('@\/lib\/world-lens\/projectile-tracer'\);/);
  });

  it('declares projectileTracerRef typed against ProjectileTracerAPI', () => {
    expect(avatarSystem).toMatch(/const projectileTracerRef = useRef<import\('@\/lib\/world-lens\/projectile-tracer'\)\.ProjectileTracerAPI \| null>\(null\);/);
  });

  it('fires the tracer only for firearm archetypes, from the discharge point to cameraLookState.aimHitPoint', () => {
    const idx = avatarSystem.indexOf('Discharge flash');
    expect(idx).toBeGreaterThan(-1);
    const block = avatarSystem.slice(idx, idx + 4000);
    expect(block).toMatch(/if \(isFirearm\) \{/);
    expect(block).toMatch(/const target = cameraLookState\.aimHitPoint \?\? \{ x: pos\.x, y: pos\.y, z: pos\.z - 40 \};/);
    expect(block).toMatch(/projectileTracerRef\.current\.fire\(\{ x: pos\.x, y: pos\.y, z: pos\.z \}, target\);/);
  });

  it('ticks the tracer every frame alongside the weapon trail', () => {
    expect(avatarSystem).toMatch(/try \{ projectileTracerRef\.current\?\.tick\(now \/ 1000\); \} catch \{ \/\* tracer best-effort \*\/ \}/);
  });

  it('disposes the tracer on unmount alongside the weapon trail', () => {
    const idx = avatarSystem.indexOf('weaponTrailRef.current?.dispose()');
    expect(idx).toBeGreaterThan(-1);
    const block = avatarSystem.slice(idx, idx + 300);
    expect(block).toMatch(/projectileTracerRef\.current\?\.dispose\(\);/);
    expect(block).toMatch(/projectileTracerRef\.current = null;/);
  });
});

describe('CombatInputController.tsx — Mouse0 fire binding', () => {
  it('gates fire on the resolved hand actually holding a pistol/rifle', () => {
    const idx = combatInput.indexOf('const dispatchFire');
    expect(idx).toBeGreaterThan(-1);
    const block = combatInput.slice(idx, idx + 1500);
    expect(block).toMatch(/if \(weaponClass !== 'pistol' && weaponClass !== 'rifle'\) return;/);
  });

  it('enforces a soft client-side cooldown floor distinct from the melee per-key cooldown map', () => {
    expect(combatInput).toMatch(/const lastRangedFireAtRef = useRef<number>\(0\);/);
    const idx = combatInput.indexOf('const dispatchFire');
    const block = combatInput.slice(idx, idx + 1500);
    expect(block).toMatch(/now - lastRangedFireAtRef\.current < 220/);
  });

  it('dispatches the same predicted concordia:combat-anim event melee attacks use, so discharge-flash/trail/tracer wiring fires for free', () => {
    const idx = combatInput.indexOf('const dispatchFire');
    const block = combatInput.slice(idx, idx + 1500);
    expect(block).toMatch(/animation: 'attack-light', predicted: true/);
  });

  it('emits combat:attack with style "fire", targeting the crosshair hit or lock-on, range-capped under the server ceiling', () => {
    const idx = combatInput.indexOf('const dispatchFire');
    const block = combatInput.slice(idx, idx + 1500);
    expect(block).toMatch(/targetId: cameraLookState\.aimHitEntityId \?\? _lockedTargetId\(\),/);
    expect(block).toMatch(/style: 'fire',/);
    expect(block).toMatch(/actionOverride: 'ranged',/);
    expect(block).toMatch(/range: 45,/);
  });

  it('binds the fire dispatch on mousedown (button 0), skipping UI-element clicks, only while a combat mode is active', () => {
    const idx = combatInput.indexOf("function onMouseDown");
    expect(idx).toBeGreaterThan(-1);
    const block = combatInput.slice(idx, idx + 500);
    expect(block).toMatch(/if \(e\.button !== 0\) return;/);
    expect(block).toMatch(/target\?\.closest\('button, \[role="button"\], input, textarea, \[data-keep-context-menu\]'\)/);
  });
});
