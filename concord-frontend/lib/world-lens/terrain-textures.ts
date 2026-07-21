/**
 * Terrain zone ground textures — real-asset-first, same pattern already
 * established for weapons/creatures/buildings/trees in this codebase
 * (warm a module-level cache asynchronously, synchronous consumers check
 * the cache and fall back gracefully when it's not resolved yet).
 *
 * TerrainRenderer.tsx previously rendered every zone as a flat per-vertex
 * hex color with zero texture images (see public/models/CREDITS.md for
 * the sourcing detail — 7 real CC-BY-4.0 tileable ground photos from
 * Roblox/creator-docs, plus `wild_grass` reusing the `grass` file and
 * `gravel` using the closest available substitute since no dedicated
 * gravel texture was found after a genuine search).
 */

import { loadTexture } from './texture-loader';
import type * as THREE_NS from 'three';

/** zone id -> texture file. Two zones intentionally share one file
 *  (`wild_grass` has no separate photo — reuses `grass`; the existing
 *  per-vertex zone-color multiply in TerrainRenderer still tints it
 *  differently). */
export const TERRAIN_ZONE_TEXTURE_FILES: Record<string, string> = {
  grass:       '/models/terrain/grass.jpg',
  wild_grass:  '/models/terrain/grass.jpg',
  dirt:        '/models/terrain/dirt.jpg',
  cobblestone: '/models/terrain/cobblestone.jpg',
  sand:        '/models/terrain/sand.jpg',
  asphalt:     '/models/terrain/asphalt.jpg',
  brick:       '/models/terrain/brick.jpg',
  gravel:      '/models/terrain/gravel.jpg',
};

const textureCache = new Map<string, THREE_NS.Texture>();
let warmed = false;
let warmingPromise: Promise<void> | null = null;

/** Idempotent, memoized, fire-and-forget-safe. Populates textureCache for
 *  every zone whose file actually loads; loadTexture() never throws — a
 *  failed fetch just leaves that zone on the vertex-color-only fallback. */
export function warmTerrainTextures(THREE: typeof THREE_NS): Promise<void> {
  if (warmed) return Promise.resolve();
  if (warmingPromise) return warmingPromise;
  warmingPromise = (async () => {
    // Dedupe by file path so a shared file (grass/wild_grass) is fetched once.
    const pathToZones = new Map<string, string[]>();
    for (const [zone, path] of Object.entries(TERRAIN_ZONE_TEXTURE_FILES)) {
      const zones = pathToZones.get(path);
      if (zones) zones.push(zone);
      else pathToZones.set(path, [zone]);
    }
    await Promise.all([...pathToZones.entries()].map(async ([path, zones]) => {
      try {
        const tex = await loadTexture(THREE, path);
        if (tex) for (const zone of zones) textureCache.set(zone, tex);
      } catch { /* this zone's real texture unavailable — vertex-color fallback covers it */ }
    }));
    warmed = true;
  })();
  return warmingPromise;
}

/** Best-effort synchronous read of an already-warmed zone texture. Returns
 *  null (never throws) if warming hasn't resolved yet or this zone has no
 *  texture file — caller keeps the existing flat vertex-color material. */
export function getTerrainTextureSync(zone: string): THREE_NS.Texture | null {
  return textureCache.get(zone) ?? null;
}
