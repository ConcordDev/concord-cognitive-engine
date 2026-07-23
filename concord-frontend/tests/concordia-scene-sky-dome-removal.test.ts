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
 *
 * The cloud-raymarch volumetric layer's mount (the eligibility gate +
 * createCloudLayer() call + scene.add/__concordClouds wiring) has since
 * been extracted out of the async init() into a standalone exported
 * function, `mountCloudLayerIfEligible`, specifically so this file can
 * drive the REAL production logic (a real THREE.Scene, the real
 * createCloudLayer from lib/world-lens/cloud-raymarch.ts — not mocked)
 * instead of only regex-matching source text.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { mountCloudLayerIfEligible } from '@/components/world-lens/ConcordiaScene';

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
});

describe('ConcordiaScene — cloud-raymarch volumetric layer: still real and still wired (mountCloudLayerIfEligible)', () => {
  it('mounts a REAL cloud layer (the actual lib/world-lens/cloud-raymarch.ts createCloudLayer, not a stub) onto the scene at high/ultra quality', async () => {
    const added: unknown[] = [];
    const scene = { add: (o: unknown) => { added.push(o); } };

    const clouds = await mountCloudLayerIfEligible(THREE, scene, 'ultra');

    expect(clouds).not.toBeNull();
    // Real THREE.Mesh built by the real createCloudLayer — proves this is
    // the genuine volumetric effect, not a removed/dead stub standing in
    // for it.
    expect(clouds!.mesh).toBeInstanceOf(THREE.Mesh);
    expect(added).toContain(clouds!.mesh);
    expect((scene as unknown as { __concordClouds?: unknown }).__concordClouds).toBe(clouds);
    // Real tick/setWeatherDensity/dispose behavior, not a distinct effect
    // that was silently dropped along with the frozen sky dome.
    expect(typeof clouds!.dispose).toBe('function');
    expect(typeof clouds!.setWeatherDensity).toBe('function');
  });

  it('is still gated to high/ultra quality only — medium/low mount nothing', async () => {
    const scene = { add: () => { throw new Error('scene.add must not be called at non-eligible quality'); } };

    expect(await mountCloudLayerIfEligible(THREE, scene, 'medium')).toBeNull();
    expect(await mountCloudLayerIfEligible(THREE, scene, 'low')).toBeNull();
  });

  it('is a distinct effect from the removed sky dome — mounting it never touches __concordSky', async () => {
    const scene = { add: () => {} } as unknown as { add: (o: unknown) => void } & { __concordSky?: unknown };
    await mountCloudLayerIfEligible(THREE, scene, 'high');
    expect(scene.__concordSky).toBeUndefined();
  });

  it('the dispose block still cleans up clouds but no longer references sky', () => {
    const disposeIdx = sceneSrc.indexOf('if (clouds?.dispose) clouds.dispose();');
    expect(disposeIdx).toBeGreaterThan(-1);
    const slice = sceneSrc.slice(Math.max(0, disposeIdx - 300), disposeIdx + 50);
    expect(slice).not.toMatch(/__concordSky/);
    expect(slice).toMatch(/__concordClouds/);
  });
});
