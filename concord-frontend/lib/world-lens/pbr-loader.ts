/**
 * Unified PBR loader — 3-tier priority on Concord's procedural-hand-
 * authored content engine.
 *
 *   1. Lens-authored DTU (canonical)
 *        GET /api/evo-asset/resolve?source=authored&sourceId=material:<kind>:<seed>
 *        ↳ players produce textures via the `art` lens; DTUs register
 *          in evo_assets; LLaVA validates aesthetic consistency;
 *          evo-asset scheduler refines on the heartbeat tick;
 *          royalty cascade tracks every derivative for 50 generations.
 *          When this resolves, it overrides everything below.
 *
 *   2. CC0 fetched pack (one-shot bootstrap; see scripts/fetch-cc0-textures.mjs)
 *        public/textures/<kind>/{color,normal,roughness,ao}.{jpg,png}
 *        ↳ Optional escape hatch when no DTU exists yet AND the
 *          procedural fallback below is too stylized for the scene.
 *
 *   3. Procedural canvas fallback (substrate-default; never absent)
 *        lib/world-lens/procedural-texture.ts
 *        ↳ Stylized PBR generator. Always available, deterministic by
 *          (kind, seed). Used when no authored DTU or CC0 pack exists.
 *
 * All three tiers return the same shape. Switching is transparent to
 * the caller; the substrate gets richer as the content engine produces
 * more authored DTUs. This is the "self-sustaining content treadmill"
 * the procedural-hand-authored engine is designed around.
 *
 * Authored layout (tier 2 — per `<kind>/`):
 *   - color.jpg / .png        (albedo)
 *   - normal.jpg / .png       (tangent-space normal map)
 *   - roughness.jpg / .png
 *   - ao.jpg / .png
 *
 * All four are optional; missing maps fall back per-channel.
 */

import type * as THREE_NS from 'three';
import type { PBRTextureSet, ProceduralKind } from './procedural-texture';
import { loadTexture } from './texture-loader';

const AUTHORED_CACHE = new Map<string, Promise<Partial<PBRTextureSet>>>();
const LENS_DTU_CACHE = new Map<string, Promise<Partial<PBRTextureSet>>>();
const TEXTURE_BASE_PATH = '/textures';
const EVO_ASSET_RESOLVE_PATH = '/api/evo-asset/resolve';

async function tryLoad(
  THREE: typeof THREE_NS,
  url: string,
): Promise<THREE_NS.Texture | null> {
  // Routes .ktx2 through the KTX2/Basis loader (mipmapped, anisotropic) and
  // PNG/JPG through TextureLoader — identical to the prior path for raster.
  return loadTexture(THREE, url);
}

/**
 * Tier 1 — resolve lens-produced texture DTUs for this material slot.
 *
 * The `art` lens publishes texture DTUs into evo_assets with
 * source='authored' (or 'evolved' after a refinement pass). Each
 * channel is a separate evo_asset row keyed by sourceId:
 *
 *   material:<kind>:<seed>:color      (albedo, always required)
 *   material:<kind>:<seed>:normal     (optional)
 *   material:<kind>:<seed>:roughness  (optional)
 *   material:<kind>:<seed>:ao         (optional)
 *
 * Per-channel registration lets the marketplace converge on the best
 * albedo independently from the best normal map, and lets LLaVA
 * validate channels independently for material consistency. Missing
 * channels fall through to tier 2 / tier 3 per-channel.
 */
async function loadLensDtu(
  THREE: typeof THREE_NS,
  kind: ProceduralKind,
  seed: number,
): Promise<Partial<PBRTextureSet>> {
  const cacheKey = `${kind}::${seed}::lens-dtu`;
  const cached = LENS_DTU_CACHE.get(cacheKey);
  if (cached) return cached;
  const promise = (async (): Promise<Partial<PBRTextureSet>> => {
    if (typeof fetch === 'undefined') return {};
    const resolveOne = async (channel: 'color' | 'normal' | 'roughness' | 'ao'): Promise<THREE_NS.Texture | null> => {
      const sourceId = `material:${kind}:${seed}:${channel}`;
      let assetUrl: string | null = null;
      try {
        const url = `${EVO_ASSET_RESOLVE_PATH}?source=authored&sourceId=${encodeURIComponent(sourceId)}`;
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) return null;
        const body = await resp.json() as { ok?: boolean; url?: string };
        if (!body?.ok || !body.url) return null;
        assetUrl = body.url;
      } catch {
        return null;
      }
      // KTX2-aware: an authored DTU served as .ktx2 decodes GPU-compressed.
      return loadTexture(THREE, assetUrl as string);
    };
    const [albedo, normal, roughness, ao] = await Promise.all([
      resolveOne('color'),
      resolveOne('normal'),
      resolveOne('roughness'),
      resolveOne('ao'),
    ]);
    const partial: Partial<PBRTextureSet> = {};
    if (albedo)    partial.albedo    = albedo;
    if (normal)    partial.normal    = normal;
    if (roughness) partial.roughness = roughness;
    if (ao)        partial.ao        = ao;
    return partial;
  })();
  LENS_DTU_CACHE.set(cacheKey, promise);
  return promise;
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
 * Get a PBR texture set for the given kind. 3-tier resolution:
 *   1. Lens-authored DTU (canonical, via /api/evo-asset/resolve)
 *   2. CC0 fetched pack at public/textures/<kind>/
 *   3. Procedural canvas fallback
 *
 * Each tier merges per-channel — a tier-1 albedo with a tier-3 ao map
 * is fine; nothing requires all four channels come from the same tier.
 *
 * Pass `preferAuthored: false` to skip tiers 1+2 entirely (useful for
 * tests + cold-start contexts where the asset endpoint isn't ready).
 */
export async function loadPBR(
  THREE: typeof THREE_NS,
  kind: ProceduralKind,
  options: { seed?: number; size?: number; preferAuthored?: boolean } = {},
): Promise<PBRTextureSet> {
  const seed = options.seed ?? 0x1357;
  const { makePBR } = await import('./procedural-texture');
  const procedural = makePBR(THREE, { kind, seed, size: options.size });

  if (options.preferAuthored === false) return procedural;

  // Tier 1: lens-authored DTU. Wins on any channel it provides.
  let lensDtu: Partial<PBRTextureSet> = {};
  try { lensDtu = await loadLensDtu(THREE, kind, seed); }
  catch { /* fall through */ }

  // Tier 2: CC0 fetched pack. Fills channels the DTU didn't.
  let authored: Partial<PBRTextureSet> = {};
  try { authored = await loadAuthored(THREE, kind); }
  catch { /* fall through */ }

  return {
    albedo:    lensDtu.albedo    ?? authored.albedo    ?? procedural.albedo,
    normal:    lensDtu.normal    ?? authored.normal    ?? procedural.normal,
    roughness: lensDtu.roughness ?? authored.roughness ?? procedural.roughness,
    ao:        lensDtu.ao        ?? authored.ao        ?? procedural.ao,
  };
}

/** Clear authored cache (call after texture pack refresh). */
export function clearAuthoredCache(): void {
  AUTHORED_CACHE.clear();
}

/** Clear lens-DTU cache (call after evo-asset promotion or marketplace canon shift). */
export function clearLensDtuCache(): void {
  LENS_DTU_CACHE.clear();
}

export const _testing = {
  AUTHORED_CACHE,
  LENS_DTU_CACHE,
  TEXTURE_BASE_PATH,
  EVO_ASSET_RESOLVE_PATH,
};
