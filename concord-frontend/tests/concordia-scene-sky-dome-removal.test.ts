/**
 * World Lens plan Phase 7a — `lib/world-lens/sky-shader.ts`'s static,
 * frozen-at-15:00 sky dome was a genuine second sky sphere coexisting
 * with `SkyWeatherRenderer`'s real, live, clock-synced one (confirmed
 * live: `createSkyDome(THREE, { radius: 2200 })` built and added its own
 * `THREE.Mesh` to the scene, called `sky.setTimeOfDayHour(15)` exactly
 * once at construction, and nothing ever updated it again — while
 * `SkyWeatherRenderer.tsx` builds its own radius-2000 shader-driven dome
 * that DOES track the real world clock). Deleted the file and its usage.
 *
 * Source-pinning per this session's established pattern — ConcordiaScene
 * is a heavy imperative Three.js file well beyond what jsdom can mount.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sceneSrc = readFileSync(
  path.resolve(__dirname, '..', 'components/world-lens/ConcordiaScene.tsx'),
  'utf8'
);

describe('ConcordiaScene — frozen sky dome removed (Phase 7a)', () => {
  it('the sky-shader.ts file itself is gone', () => {
    const skyShaderPath = path.resolve(__dirname, '..', 'lib/world-lens/sky-shader.ts');
    expect(existsSync(skyShaderPath)).toBe(false);
  });

  it('no longer imports createSkyDome or references sky-shader.ts', () => {
    expect(sceneSrc).not.toMatch(/createSkyDome/);
    expect(sceneSrc).not.toMatch(/from '@\/lib\/world-lens\/sky-shader'/);
    expect(sceneSrc).not.toMatch(/setTimeOfDayHour\(15\)/);
  });

  it('no longer sets __concordSky on the scene', () => {
    expect(sceneSrc).not.toMatch(/__concordSky/);
  });

  it('the cloud-raymarch volumetric layer is still real and still wired (a distinct effect, not removed)', () => {
    expect(sceneSrc).toMatch(/await import\('@\/lib\/world-lens\/cloud-raymarch'\)/);
    expect(sceneSrc).toMatch(/createCloudLayer\(THREE, \{ radius: 1600 \}\)/);
    expect(sceneSrc).toMatch(/__concordClouds/);
  });

  it('the cloud layer is still gated to high/ultra quality only', () => {
    const idx = sceneSrc.indexOf("await import('@/lib/world-lens/cloud-raymarch')");
    expect(idx).toBeGreaterThan(-1);
    const before = sceneSrc.slice(Math.max(0, idx - 300), idx);
    expect(before).toMatch(/quality === 'high' \|\| quality === 'ultra'/);
  });

  it('the dispose block still cleans up clouds but no longer references sky', () => {
    const disposeIdx = sceneSrc.indexOf('if (clouds?.dispose) clouds.dispose();');
    expect(disposeIdx).toBeGreaterThan(-1);
    const slice = sceneSrc.slice(Math.max(0, disposeIdx - 300), disposeIdx + 50);
    expect(slice).not.toMatch(/__concordSky/);
    expect(slice).toMatch(/__concordClouds/);
  });
});
