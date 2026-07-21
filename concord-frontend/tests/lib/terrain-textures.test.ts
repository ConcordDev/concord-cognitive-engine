// Real-asset-first ground textures for TerrainRenderer.tsx (previously
// every zone was a flat per-vertex hex color, zero texture images — see
// public/models/CREDITS.md). texture-loader.ts's loadTexture() is mocked
// so this is deterministic and doesn't hit the network/filesystem.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as THREE_NS from 'three';
import type * as TerrainTexturesModule from '@/lib/world-lens/terrain-textures';

const mockLoadTexture = vi.fn();

vi.mock('@/lib/world-lens/texture-loader', () => ({
  loadTexture: (...args: unknown[]) => mockLoadTexture(...args),
}));

function fakeTexture(id: string): THREE_NS.Texture {
  return { __id: id, repeat: { set: vi.fn() } } as unknown as THREE_NS.Texture;
}

/** Fresh module instance per call — resets the module-level warm-cache
 *  state so each test controls its own scenario (mirrors weapon-archetypes'
 *  own test harness pattern). */
async function freshModule(): Promise<typeof TerrainTexturesModule> {
  vi.resetModules();
  return import('@/lib/world-lens/terrain-textures');
}

describe('TERRAIN_ZONE_TEXTURE_FILES', () => {
  it('covers all 8 TerrainRenderer zones', async () => {
    const { TERRAIN_ZONE_TEXTURE_FILES } = await freshModule();
    const zones = ['cobblestone', 'asphalt', 'brick', 'grass', 'gravel', 'wild_grass', 'dirt', 'sand'];
    for (const zone of zones) {
      expect(TERRAIN_ZONE_TEXTURE_FILES[zone], `${zone} should have a texture file mapped`).toBeTruthy();
    }
  });

  it('wild_grass intentionally shares the grass file (no separate photo sourced)', async () => {
    const { TERRAIN_ZONE_TEXTURE_FILES } = await freshModule();
    expect(TERRAIN_ZONE_TEXTURE_FILES.wild_grass).toBe(TERRAIN_ZONE_TEXTURE_FILES.grass);
  });

  it('every other zone has a distinct file (no accidental sharing)', async () => {
    const { TERRAIN_ZONE_TEXTURE_FILES } = await freshModule();
    const distinctZones = ['cobblestone', 'asphalt', 'brick', 'grass', 'gravel', 'dirt', 'sand'];
    const paths = distinctZones.map((z) => TERRAIN_ZONE_TEXTURE_FILES[z]);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('warmTerrainTextures / getTerrainTextureSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('before warming resolves, getTerrainTextureSync returns null for every zone', async () => {
    mockLoadTexture.mockImplementation(() => new Promise(() => {})); // never resolves
    const { getTerrainTextureSync } = await freshModule();
    expect(getTerrainTextureSync('grass')).toBeNull();
    expect(getTerrainTextureSync('dirt')).toBeNull();
  });

  it('after warming resolves, getTerrainTextureSync returns the loaded texture per zone', async () => {
    mockLoadTexture.mockImplementation(async (_THREE: unknown, url: string) => fakeTexture(url));
    const { warmTerrainTextures, getTerrainTextureSync } = await freshModule();
    await warmTerrainTextures({} as typeof THREE_NS);
    const grass = getTerrainTextureSync('grass');
    const dirt = getTerrainTextureSync('dirt');
    expect(grass).not.toBeNull();
    expect(dirt).not.toBeNull();
    expect(grass).not.toBe(dirt); // distinct files → distinct texture instances
  });

  it('grass and wild_grass resolve to the SAME texture instance (shared file, deduped fetch)', async () => {
    mockLoadTexture.mockImplementation(async (_THREE: unknown, url: string) => fakeTexture(url));
    const { warmTerrainTextures, getTerrainTextureSync } = await freshModule();
    await warmTerrainTextures({} as typeof THREE_NS);
    expect(getTerrainTextureSync('grass')).toBe(getTerrainTextureSync('wild_grass'));
  });

  it('loadTexture is called once per distinct file, not once per zone (grass file fetched once for 2 zones)', async () => {
    mockLoadTexture.mockImplementation(async (_THREE: unknown, url: string) => fakeTexture(url));
    const { warmTerrainTextures } = await freshModule();
    await warmTerrainTextures({} as typeof THREE_NS);
    const grassCalls = mockLoadTexture.mock.calls.filter((c) => c[1] === '/models/terrain/grass.jpg');
    expect(grassCalls.length).toBe(1);
  });

  it('a zone whose file fails to load stays null — never throws, no other zone affected', async () => {
    mockLoadTexture.mockImplementation(async (_THREE: unknown, url: string) => {
      if (url === '/models/terrain/sand.jpg') return null; // simulated load failure
      return fakeTexture(url);
    });
    const { warmTerrainTextures, getTerrainTextureSync } = await freshModule();
    await expect(warmTerrainTextures({} as typeof THREE_NS)).resolves.not.toThrow();
    expect(getTerrainTextureSync('sand')).toBeNull();
    expect(getTerrainTextureSync('grass')).not.toBeNull(); // unaffected
  });

  it('warmTerrainTextures() is memoized — a second call does not re-invoke loadTexture', async () => {
    mockLoadTexture.mockImplementation(async (_THREE: unknown, url: string) => fakeTexture(url));
    const { warmTerrainTextures } = await freshModule();
    await warmTerrainTextures({} as typeof THREE_NS);
    const callsAfterFirst = mockLoadTexture.mock.calls.length;
    await warmTerrainTextures({} as typeof THREE_NS);
    expect(mockLoadTexture.mock.calls.length).toBe(callsAfterFirst);
  });

  it('concurrent warm calls before resolution share one in-flight promise', async () => {
    // One loadTexture() call per distinct file (7 of them) — collect every
    // resolver, not just the last, so Promise.all() inside the module
    // actually settles instead of hanging on unresolved earlier calls.
    const resolvers: Array<(t: THREE_NS.Texture | null) => void> = [];
    mockLoadTexture.mockImplementation((_THREE: unknown, url: string) => new Promise((resolve) => {
      resolvers.push(() => resolve(fakeTexture(url)));
    }));
    const { warmTerrainTextures } = await freshModule();
    const p1 = warmTerrainTextures({} as typeof THREE_NS);
    const p2 = warmTerrainTextures({} as typeof THREE_NS);
    expect(p1).toBe(p2);
    resolvers.forEach((r) => r());
    await p1;
  });
});
