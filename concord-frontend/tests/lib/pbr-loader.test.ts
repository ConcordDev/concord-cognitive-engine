import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { loadPBR, clearAuthoredCache, _testing } from '@/lib/world-lens/pbr-loader';

describe('loadPBR', () => {
  beforeEach(() => {
    clearAuthoredCache();
    // Mock TextureLoader.load so we don't actually fetch.
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(
      (_url: string, _onLoad?: unknown, _onProgress?: unknown, onError?: unknown) => {
        if (typeof onError === 'function') (onError as (e: unknown) => void)({});
        return new THREE.Texture();
      },
    );
  });

  it('returns a 4-channel set on missing authored', async () => {
    const set = await loadPBR(THREE, 'stone', { size: 32 });
    expect(set.albedo).toBeDefined();
    expect(set.normal).toBeDefined();
    expect(set.roughness).toBeDefined();
    expect(set.ao).toBeDefined();
  });

  it('caches authored attempts per kind', async () => {
    await loadPBR(THREE, 'stone', { size: 32 });
    await loadPBR(THREE, 'stone', { size: 32 });
    expect(_testing.AUTHORED_CACHE.has('stone::authored')).toBe(true);
  });

  it('preferAuthored=false skips authored fetch', async () => {
    const set = await loadPBR(THREE, 'wood', { size: 32, preferAuthored: false });
    expect(set.albedo).toBeDefined();
    expect(_testing.AUTHORED_CACHE.has('wood::authored')).toBe(false);
  });

  it('TEXTURE_BASE_PATH is /textures', () => {
    expect(_testing.TEXTURE_BASE_PATH).toBe('/textures');
  });
});
