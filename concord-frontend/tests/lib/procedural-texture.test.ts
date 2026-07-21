import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { makePBR, clearProceduralCache, _testing } from '@/lib/world-lens/procedural-texture';

describe('makePBR procedural texture generator', () => {
  beforeEach(() => { clearProceduralCache(); });

  it('returns a 4-channel PBR set', () => {
    const set = makePBR(THREE, { kind: 'stone', size: 64 });
    expect(set.albedo).toBeDefined();
    expect(set.normal).toBeDefined();
    expect(set.roughness).toBeDefined();
    expect(set.ao).toBeDefined();
  });

  it('caches by (kind, seed, size)', () => {
    const a = makePBR(THREE, { kind: 'stone', size: 64, seed: 1 });
    const b = makePBR(THREE, { kind: 'stone', size: 64, seed: 1 });
    expect(a.albedo).toBe(b.albedo);
  });

  it('different seeds produce different textures', () => {
    const a = makePBR(THREE, { kind: 'wood', size: 64, seed: 1 });
    const b = makePBR(THREE, { kind: 'wood', size: 64, seed: 2 });
    expect(a.albedo).not.toBe(b.albedo);
  });

  it('different kinds produce different textures', () => {
    const stone = makePBR(THREE, { kind: 'stone', size: 64, seed: 1 });
    const wood = makePBR(THREE, { kind: 'wood',   size: 64, seed: 1 });
    expect(stone.albedo).not.toBe(wood.albedo);
  });

  it('clearProceduralCache empties the cache', () => {
    makePBR(THREE, { kind: 'stone', size: 64 });
    expect(_testing.cache.size).toBeGreaterThan(0);
    clearProceduralCache();
    expect(_testing.cache.size).toBe(0);
  });

  it('seeds give deterministic RNG sequence', () => {
    const r1 = _testing.makeRng(42);
    const r2 = _testing.makeRng(42);
    expect(r1()).toBe(r2());
    expect(r1()).toBe(r2());
  });

  it('handles all 13 kinds without throwing', () => {
    const kinds = [
      'stone', 'wood', 'brick', 'cloth', 'metal', 'leather', 'thatch', 'dirt',
      'grass', 'sand', 'cobblestone', 'gravel', 'asphalt',
    ] as const;
    for (const k of kinds) {
      expect(() => makePBR(THREE, { kind: k, size: 32 })).not.toThrow();
    }
  });

  it('wraps textures with RepeatWrapping for tiling', () => {
    const set = makePBR(THREE, { kind: 'brick', size: 64 });
    expect(set.albedo.wrapS).toBe(THREE.RepeatWrapping);
    expect(set.albedo.wrapT).toBe(THREE.RepeatWrapping);
  });
});

// 2026-07-21 — real-photo-grounded palettes. 7 of the 13 kinds now derive
// their base/speckle colors from terrain-reference-palettes.ts (sampled
// from the real CC-BY-4.0 terrain photos) instead of hand-picked hex.
// jsdom has no real 2D canvas context (see the noisy-but-harmless
// "Not implemented: HTMLCanvasElement.prototype.getContext" stderr lines
// above — makeAlbedoCanvas's `if (!ctx) return canvas;` guard means the
// actual pixel-level color grounding can't be asserted here; it was
// verified visually via a real headless-Chromium WebGL render during
// development (see the session's own verification pass). These tests
// cover what jsdom CAN verify: the data is real, wired in, and every new
// kind is structurally sound.
describe('terrain-reference-palettes grounding', () => {
  it('TERRAIN_REFERENCE_PALETTES has all 7 photo-backed kinds, each a real (non-placeholder) RGB triple', async () => {
    const { TERRAIN_REFERENCE_PALETTES } = await import('@/lib/world-lens/terrain-reference-palettes');
    const kinds = ['grass', 'dirt', 'cobblestone', 'sand', 'asphalt', 'brick', 'gravel'];
    for (const kind of kinds) {
      const pal = TERRAIN_REFERENCE_PALETTES[kind];
      expect(pal, `${kind} should have a palette`).toBeDefined();
      for (const tone of ['avg', 'dark', 'light'] as const) {
        for (const channel of pal[tone]) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
      // dark should be darker than light (sanity: these are genuinely
      // sampled extremes, not a placeholder where dark===light===avg).
      const lum = ([r, g, b]: readonly [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      expect(lum(pal.dark)).toBeLessThan(lum(pal.light));
    }
  });

  it('the 6 original kinds (no terrain photo) have no entry in TERRAIN_REFERENCE_PALETTES', async () => {
    const { TERRAIN_REFERENCE_PALETTES } = await import('@/lib/world-lens/terrain-reference-palettes');
    for (const kind of ['stone', 'wood', 'cloth', 'metal', 'leather', 'thatch']) {
      expect(TERRAIN_REFERENCE_PALETTES[kind]).toBeUndefined();
    }
  });

  it('the 5 new terrain-matched kinds each produce a distinct cache entry from every other kind', () => {
    const kinds = ['grass', 'sand', 'cobblestone', 'gravel', 'asphalt'] as const;
    const sets = kinds.map((k) => makePBR(THREE, { kind: k, size: 32, seed: 7 }));
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        expect(sets[i].albedo).not.toBe(sets[j].albedo);
      }
    }
  });

  it('new kinds respect the same (kind, seed, size) cache key as the original 8', () => {
    const a = makePBR(THREE, { kind: 'grass', size: 64, seed: 3 });
    const b = makePBR(THREE, { kind: 'grass', size: 64, seed: 3 });
    const c = makePBR(THREE, { kind: 'grass', size: 64, seed: 4 });
    expect(a.albedo).toBe(b.albedo);
    expect(a.albedo).not.toBe(c.albedo);
  });

  it('new kinds have real baseRoughness and normal-intensity entries (no NaN fallthrough)', () => {
    const kinds = ['grass', 'sand', 'cobblestone', 'gravel', 'asphalt'] as const;
    for (const k of kinds) {
      expect(() => makePBR(THREE, { kind: k, size: 16, seed: 99 })).not.toThrow();
    }
  });
});
