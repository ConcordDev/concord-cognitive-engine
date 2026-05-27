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

  it('handles all 8 kinds without throwing', () => {
    const kinds = ['stone', 'wood', 'brick', 'cloth', 'metal', 'leather', 'thatch', 'dirt'] as const;
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
