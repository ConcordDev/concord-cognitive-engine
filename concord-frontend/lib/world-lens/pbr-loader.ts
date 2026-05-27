/**
 * Unified PBR loader.
 *
 * Prefers authored textures from `public/textures/<kind>/` (dropped in
 * by scripts/fetch-cc0-textures.mjs or hand-authored sets) over the
 * procedural canvas-based generator. Same return shape; transparent
 * swap. Falls back to procedural if a fetch fails or no authored set
 * exists.
 *
 * Authored layout (per `<kind>/`):
 *   - color.jpg / .png        (albedo)
 *   - normal.jpg / .png       (tangent-space normal map)
 *   - roughness.jpg / .png
 *   - ao.jpg / .png
 *
 * All four are optional; missing maps fall back to procedural for that
 * channel only.
 */

import type * as THREE_NS from 'three';
import type { PBRTextureSet, ProceduralKind } from './procedural-texture';

const AUTHORED_CACHE = new Map<string, Promise<Partial<PBRTextureSet>>>();
const TEXTURE_BASE_PATH = '/textures';

async function tryLoad(
  THREE: typeof THREE_NS,
  url: string,
): Promise<THREE_NS.Texture | null> {
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        resolve(tex);
      },
      undefined,
      () => resolve(null),
    );
  });
}

async function loadAuthored(
  THREE: typeof THREE_NS,
  kind: ProceduralKind,
): Promise<Partial<PBRTextureSet>> {
  const key = `${kind}::authored`;
  const cached = AUTHORED_CACHE.get(key);
  if (cached) return cached;
  const promise = (async () => {
    const dir = `${TEXTURE_BASE_PATH}/${kind}`;
    const exts = ['jpg', 'png'];
    const tryEach = async (base: string) => {
      for (const ext of exts) {
        const tex = await tryLoad(THREE, `${dir}/${base}.${ext}`);
        if (tex) return tex;
      }
      return null;
    };
    const [albedo, normal, roughness, ao] = await Promise.all([
      tryEach('color'),
      tryEach('normal'),
      tryEach('roughness'),
      tryEach('ao'),
    ]);
    const partial: Partial<PBRTextureSet> = {};
    if (albedo)    partial.albedo    = albedo;
    if (normal)    partial.normal    = normal;
    if (roughness) partial.roughness = roughness;
    if (ao)        partial.ao        = ao;
    return partial;
  })();
  AUTHORED_CACHE.set(key, promise);
  return promise;
}

/**
 * Get a PBR texture set for the given kind. Tries authored textures
 * first; falls back per-channel to procedural.
 */
export async function loadPBR(
  THREE: typeof THREE_NS,
  kind: ProceduralKind,
  options: { seed?: number; size?: number; preferAuthored?: boolean } = {},
): Promise<PBRTextureSet> {
  const { makePBR } = await import('./procedural-texture');
  const procedural = makePBR(THREE, { kind, seed: options.seed, size: options.size });

  if (options.preferAuthored === false) return procedural;

  let authored: Partial<PBRTextureSet> = {};
  try {
    authored = await loadAuthored(THREE, kind);
  } catch {
    /* fall through to procedural */
  }
  return {
    albedo:    authored.albedo    ?? procedural.albedo,
    normal:    authored.normal    ?? procedural.normal,
    roughness: authored.roughness ?? procedural.roughness,
    ao:        authored.ao        ?? procedural.ao,
  };
}

/** Clear authored cache (call after texture pack refresh). */
export function clearAuthoredCache(): void {
  AUTHORED_CACHE.clear();
}

export const _testing = { AUTHORED_CACHE, TEXTURE_BASE_PATH };
