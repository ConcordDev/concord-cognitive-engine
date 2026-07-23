/**
 * Runtime-health backlog item (Concordia audit, finding #14 —
 * `docs/concordia-specs/runtime-health-capability-map.md`):
 *
 * WaterRenderer's `buildWater()` allocates a fresh `THREE.DataTexture`
 * (up to 512x512 RGBA) on every effect run and binds it as a *custom*
 * ShaderMaterial uniform (`uNormalMap`) rather than a standard `.map` /
 * `.normalMap` material property. The effect's cleanup only did the
 * generic `geometry.dispose()` + `material.dispose()` traverse, which never
 * reaches uniform-bound textures — so every rebuild (the effect re-runs on
 * `[riverConfig, creekPath, timeOfDay/timeBucket, quality]`) leaked a
 * texture.
 *
 * Most of this file's static pins remain (WaterRenderer.tsx pulls in the
 * full Three.js scene-construction pipeline, and this codebase's own
 * established tests for similarly Three.js-heavy files treat full render
 * assertions on the geometry/shader internals as unnecessary weight). But
 * the specific claim that the effect's DEPENDENCY ARRAY uses the coarse
 * `timeBucket` (not the raw continuous `timeOfDay`) is a real, mountable
 * React behavior — WaterRenderer doesn't block on any WebGL renderer or
 * external "ready" event to build its water group, so this file drives a
 * REAL render + rerender cycle and asserts on the real
 * `concordia:water-ready` dispatch (fired once per actual effect run) to
 * prove same-bucket prop changes do NOT retrigger the rebuild and
 * bucket-crossing changes DO — real coverage of the leak-frequency fix,
 * not a source-text pin of which identifier sits in a dependency array.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import WaterRenderer, { timeOfDayBucket } from '../../components/world-lens/WaterRenderer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const waterSrc = readFileSync(
  path.resolve(__dirname, '..', '..', 'components', 'world-lens', 'WaterRenderer.tsx'),
  'utf8',
);

const RIVER_CONFIG = { width: 40, flowDirection: 0, flowSpeed: 1, centerX: 0, length: 200 };
// Stable references across rerenders — a fresh array/object literal on
// every render would itself retrigger the effect via referential inequality
// in the dependency array, which would confound (not test) the timeBucket
// claim this suite exists to prove.
const CREEK_PATH: { x: number; z: number }[] = [];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('WaterRenderer — normal-map texture disposal (finding #14), static pins', () => {
  it('tracks the current normal-map texture in a ref', () => {
    expect(waterSrc).toMatch(/const normalMapTexRef = useRef<\{ dispose: \(\) => void \} \| null>\(null\);/);
  });

  it('stores the newly-built texture in the ref (not just the material/geometry it\'s bound to)', () => {
    expect(waterSrc).toMatch(/normalMapTexRef\.current = normalMapTex;/);
  });

  it('disposes the previous texture on unmount/rebuild cleanup', () => {
    const cleanupMatch = waterSrc.match(/return \(\) => \{[\s\S]*?\n {4}\};\n {2}\}, \[/);
    expect(cleanupMatch).toBeTruthy();
    const cleanup = cleanupMatch![0];
    expect(cleanup).toMatch(/if \(normalMapTexRef\.current\) \{/);
    expect(cleanup).toMatch(/normalMapTexRef\.current\.dispose\(\);/);
    expect(cleanup).toMatch(/normalMapTexRef\.current = null;/);
  });

  it('guards against a texture created after the effect was already torn down (disposed=true race during the pending `await import(\'three\')`)', () => {
    expect(waterSrc).toMatch(/if \(disposed\) \{\s*\n\s*normalMapTex\.dispose\(\);\s*\n\s*return;\s*\n\s*\}/);
  });

  it('no leftover debug logging from development iteration', () => {
    expect(waterSrc).not.toMatch(/console\.(log|error)\(['"](COMPONENT BODY|EFFECT RUN|buildWater|CLEANUP RUN)/);
  });
});

describe('WaterRenderer — timeOfDayBucket() (real, isolated behavioral test of the dependency-frequency fix)', () => {
  it('buckets the four documented bands correctly, matching the original inline isDawn/isDusk/isNight logic exactly', () => {
    // Original inline logic (now relocated, not changed):
    //   isDawn  = timeOfDay >= 5  && timeOfDay < 8
    //   isDusk  = timeOfDay >= 17 && timeOfDay < 20
    //   isNight = timeOfDay < 5   || timeOfDay >= 20
    //   day     = everything else (8..17)
    expect(timeOfDayBucket(0)).toBe('night');
    expect(timeOfDayBucket(4.99)).toBe('night');
    expect(timeOfDayBucket(5)).toBe('dawn');
    expect(timeOfDayBucket(7.99)).toBe('dawn');
    expect(timeOfDayBucket(8)).toBe('day');
    expect(timeOfDayBucket(12)).toBe('day');
    expect(timeOfDayBucket(16.99)).toBe('day');
    expect(timeOfDayBucket(17)).toBe('dusk');
    expect(timeOfDayBucket(19.99)).toBe('dusk');
    expect(timeOfDayBucket(20)).toBe('night');
    expect(timeOfDayBucket(23.99)).toBe('night');
  });

  it('a same-bucket change (e.g. 12 -> 13.5, both "day") returns the identical bucket — the exact case that must NOT retrigger the effect', () => {
    expect(timeOfDayBucket(12)).toBe(timeOfDayBucket(13.5));
  });

  it('a band-crossing change (e.g. 7.9 "dawn" -> 8.1 "day") returns a different bucket — the case that correctly MUST retrigger the effect', () => {
    expect(timeOfDayBucket(7.9)).not.toBe(timeOfDayBucket(8.1));
  });
});

describe('WaterRenderer — the effect actually keys off timeBucket, not raw timeOfDay (real mount + rerender)', () => {
  it('does NOT rebuild the water group on a same-bucket timeOfDay change, but DOES rebuild across a bucket boundary', async () => {
    const onReady = vi.fn();
    window.addEventListener('concordia:water-ready', onReady);
    try {
      const { rerender } = render(
        <WaterRenderer riverConfig={RIVER_CONFIG} creekPath={CREEK_PATH} timeOfDay={12} quality="low" />,
      );
      await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 3000 });

      // 12 -> 13.5: both bucket 'day' (asserted above via timeOfDayBucket).
      // If the effect depended on raw timeOfDay this would rebuild (and
      // leak another DataTexture); it must not.
      rerender(
        <WaterRenderer riverConfig={RIVER_CONFIG} creekPath={CREEK_PATH} timeOfDay={13.5} quality="low" />,
      );
      await sleep(150);
      expect(onReady).toHaveBeenCalledTimes(1);

      // 13.5 ('day') -> 20 ('night'): a real bucket crossing must rebuild.
      rerender(
        <WaterRenderer riverConfig={RIVER_CONFIG} creekPath={CREEK_PATH} timeOfDay={20} quality="low" />,
      );
      await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(2), { timeout: 3000 });
    } finally {
      window.removeEventListener('concordia:water-ready', onReady);
    }
  }, 10000);
});
