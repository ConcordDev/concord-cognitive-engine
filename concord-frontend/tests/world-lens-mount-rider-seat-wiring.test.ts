// Mount rider-seat activation — AvatarSystem3D.tsx (Three.js/DOM-heavy,
// source-pinned per this repo's established pattern, see
// tests/world-lens-ranged-combat-wiring.test.ts's own header comment).
//
// rider-ik.ts's astride-seat lift (computeRiderIkTargets) was fully built
// and tested (tests/components/MountAvatar3D.test.tsx) but never actually
// activated: it read window.__concordMountRiderSeat === true, a flag
// nothing in the codebase ever set, so the mount always rendered as
// "following under the rider" rather than the rider genuinely sitting the
// saddle with gait bounce. Naively flipping the flag on isn't safe by
// itself — the movement loop's terrain-elevation clamp (which runs AFTER
// the rider-ik eyeTicker in the same frame) unconditionally set
// pm.position.y from a ground-height value, stomping the seat lift back
// down every single frame while moving. This file pins both halves of the
// real fix: the seat activates by default, and the terrain clamp / final
// position.set no longer fight it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '..', 'components/world-lens/AvatarSystem3D.tsx'),
  'utf8',
);

describe('AvatarSystem3D.tsx — mount rider-seat activation', () => {
  it('declares isMountedRiderRef, defaulting to false', () => {
    expect(src).toMatch(/const isMountedRiderRef = useRef\(false\);/);
  });

  it('sets isMountedRiderRef true when the mount actually spawns', () => {
    const idx = src.indexOf('avatarGroup.add(m.group);');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 200);
    expect(block).toMatch(/isMountedRiderRef\.current = true;/);
  });

  it('seatOn defaults to true — the seat lift is on unless a caller explicitly opts out via window.__concordMountRiderSeat = false', () => {
    const idx = src.indexOf('const seatOn =');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 200);
    expect(block).toMatch(/__concordMountRiderSeat\?: boolean \}\)\.__concordMountRiderSeat !== false;/);
  });

  it('resets isMountedRiderRef to false on unmount so a remount without a mount does not carry a stale true', () => {
    const idx = src.indexOf('eyeTickers.clear();');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 100);
    expect(block).toMatch(/isMountedRiderRef\.current = false;/);
  });

  it('the terrain-elevation clamp uses a saddle-height approximation while mounted instead of the raw ground elevation', () => {
    const idx = src.indexOf('Terrain elevation — clamp Y to ground');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 1000);
    expect(block).toMatch(/pos\.y = isMountedRiderRef\.current \? elevation \+ 1\.3 : elevation;/);
  });

  it('the final per-frame position.set skips overwriting Y while mounted, so it never stomps the rider-ik eyeTicker\'s seat-bounce write from earlier in the same frame', () => {
    const idx = src.indexOf('const pm = playerMeshRef.current as InstanceType<typeof import(\'three\').Group>;');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 500);
    expect(block).toMatch(/if \(isMountedRiderRef\.current\) \{/);
    expect(block).toMatch(/pm\.position\.x = pos\.x;/);
    expect(block).toMatch(/pm\.position\.z = pos\.z;/);
    expect(block).toMatch(/\} else \{\s*pm\.position\.set\(pos\.x, pos\.y, pos\.z\);/);
  });
});
