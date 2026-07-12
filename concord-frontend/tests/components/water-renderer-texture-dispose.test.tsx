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
 * WaterRenderer.tsx pulls in the full Three.js scene-construction pipeline
 * (geometry, foam, creek ribbon, reflections) that this codebase's own
 * established tests for similarly Three.js-heavy files (e.g.
 * avatar-system-effect-stability.test.tsx, whose own comment documents this)
 * treat as unmountable in jsdom — an earlier attempt at a real-mount,
 * wait-for-`concordia:water-ready`-event test for this exact fix
 * consistently timed out for that reason. This file follows the same
 * established pattern instead: static source-text pins on the production
 * fix, plus a real, isolated behavioral test of `timeOfDayBucket()` (a pure
 * function, exported specifically so it can be tested directly rather than
 * only indirectly through a full component mount).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timeOfDayBucket } from '../../components/world-lens/WaterRenderer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const waterSrc = readFileSync(
  path.resolve(__dirname, '..', '..', 'components', 'world-lens', 'WaterRenderer.tsx'),
  'utf8',
);

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

  it('the effect dependency array uses the coarse timeBucket, not the raw continuous timeOfDay (the fix that reduces how often the leak can even fire)', () => {
    expect(waterSrc).toMatch(/\}, \[riverConfig, creekPath, timeBucket, quality\]\);/);
    // The raw prop must still be read (bucket is derived from it) but must
    // NOT be the effect's own dependency — that was the amplifier: a
    // continuously-advancing timeOfDay rebuilding (and re-leaking) on every
    // fractional tick instead of only at real day/night band transitions.
    expect(waterSrc).not.toMatch(/\}, \[riverConfig, creekPath, timeOfDay, quality\]\);/);
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
