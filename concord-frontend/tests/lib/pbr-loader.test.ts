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

  it('tier-1 lens DTU calls the evo-asset resolve endpoint per channel', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'not_registered' }),
    });
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;
    await loadPBR(THREE, 'metal', { size: 32, seed: 7 });
    expect(fetchSpy).toHaveBeenCalled();
    // 4 resolve calls — one per channel
    const calledUrls = fetchSpy.mock.calls.map((c) => c[0] as string);
    expect(calledUrls.length).toBe(4);
    expect(calledUrls.every((u) => u.includes('/api/evo-asset/resolve'))).toBe(true);
    expect(calledUrls.every((u) => u.includes('source=authored'))).toBe(true);
    // Each channel encodes into its own sourceId
    expect(calledUrls.some((u) => u.includes('sourceId=material%3Ametal%3A7%3Acolor'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('sourceId=material%3Ametal%3A7%3Anormal'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('sourceId=material%3Ametal%3A7%3Aroughness'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('sourceId=material%3Ametal%3A7%3Aao'))).toBe(true);
  });

  it('tier-1 resolved channel wins over tier-3 procedural per-channel', async () => {
    // Resolve endpoint: color sourceId returns a URL; the others 404.
    (globalThis as { fetch?: unknown }).fetch = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes('%3Acolor')
          ? { ok: true, url: '/api/evo-asset/file/test-id?v=3' }
          : { ok: false, error: 'not_registered' },
    }));
    const dtuTexture = new THREE.Texture();
    (dtuTexture as unknown as { __isDtu?: boolean }).__isDtu = true;
    // Only the DTU file URL succeeds; tier-2 public/textures paths fail.
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(
      (url: string, onLoad?: unknown, _onProgress?: unknown, onError?: unknown) => {
        if (url.includes('/api/evo-asset/file/') && typeof onLoad === 'function') {
          (onLoad as (t: THREE.Texture) => void)(dtuTexture);
        } else if (typeof onError === 'function') {
          (onError as (e: unknown) => void)({});
        }
        return new THREE.Texture();
      },
    );
    const set = await loadPBR(THREE, 'dirt', { size: 32, seed: 11 });
    expect((set.albedo as unknown as { __isDtu?: boolean }).__isDtu).toBe(true);
    // Other channels stay procedural (no resolve URL → no texture load)
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
