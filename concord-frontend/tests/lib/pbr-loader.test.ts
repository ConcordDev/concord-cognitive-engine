import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import {
  loadPBR,
  clearAuthoredCache,
  clearLensDtuCache,
  _testing,
} from '@/lib/world-lens/pbr-loader';

describe('loadPBR — 3-tier resolution', () => {
  beforeEach(() => {
    clearAuthoredCache();
    clearLensDtuCache();
    // Default: TextureLoader fails (no on-disk authored / DTU files)
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(
      (_url: string, _onLoad?: unknown, _onProgress?: unknown, onError?: unknown) => {
        if (typeof onError === 'function') (onError as (e: unknown) => void)({});
        return new THREE.Texture();
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Remove any fetch mock installed by individual tests
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('tier-3 fallback: returns a 4-channel set on missing authored + missing DTU', async () => {
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

  it('caches lens-DTU attempts per (kind, seed)', async () => {
    // fetch returns 404 — DTU not registered for this slot
    (globalThis as { fetch?: unknown }).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'not_registered' }),
    });
    await loadPBR(THREE, 'brick', { size: 32, seed: 42 });
    expect(_testing.LENS_DTU_CACHE.has('brick::42::lens-dtu')).toBe(true);
  });

  it('preferAuthored=false skips both tier-1 and tier-2', async () => {
    const fetchSpy = vi.fn();
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;
    const set = await loadPBR(THREE, 'wood', { size: 32, preferAuthored: false });
    expect(set.albedo).toBeDefined();
    expect(_testing.AUTHORED_CACHE.has('wood::authored')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('tier-1 lens DTU calls the evo-asset resolve endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'not_registered' }),
    });
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;
    await loadPBR(THREE, 'metal', { size: 32, seed: 7 });
    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/evo-asset/resolve');
    expect(calledUrl).toContain('source=authored');
    expect(calledUrl).toContain('sourceId=material%3Ametal%3A7');
  });

  it('tier-1 resolved DTU wins per-channel over tier-3 procedural', async () => {
    // resolve endpoint returns a URL; texture loader returns a fake texture
    // for color, fails for the other channels.
    (globalThis as { fetch?: unknown }).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, url: '/api/evo-asset/file/test-id?v=3' }),
    });
    const dtuTexture = new THREE.Texture();
    (dtuTexture as unknown as { __isDtu?: boolean }).__isDtu = true;
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(
      (url: string, onLoad?: unknown, _onProgress?: unknown, onError?: unknown) => {
        if (url.includes('channel=color') && typeof onLoad === 'function') {
          (onLoad as (t: THREE.Texture) => void)(dtuTexture);
        } else if (typeof onError === 'function') {
          (onError as (e: unknown) => void)({});
        }
        return new THREE.Texture();
      },
    );
    const set = await loadPBR(THREE, 'dirt', { size: 32, seed: 11 });
    expect((set.albedo as unknown as { __isDtu?: boolean }).__isDtu).toBe(true);
    // Other channels stay procedural
    expect((set.normal as unknown as { __isDtu?: boolean }).__isDtu).toBeUndefined();
  });

  it('exposed paths are stable', () => {
    expect(_testing.TEXTURE_BASE_PATH).toBe('/textures');
    expect(_testing.EVO_ASSET_RESOLVE_PATH).toBe('/api/evo-asset/resolve');
  });

  it('clearLensDtuCache empties the cache', async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false }),
    });
    await loadPBR(THREE, 'cloth', { size: 32, seed: 1 });
    expect(_testing.LENS_DTU_CACHE.size).toBeGreaterThan(0);
    clearLensDtuCache();
    expect(_testing.LENS_DTU_CACHE.size).toBe(0);
  });

  it('survives fetch throwing — falls back to authored + procedural', async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn().mockRejectedValue(new Error('net'));
    const set = await loadPBR(THREE, 'thatch', { size: 32, seed: 99 });
    expect(set.albedo).toBeDefined();
    expect(set.normal).toBeDefined();
  });
});
