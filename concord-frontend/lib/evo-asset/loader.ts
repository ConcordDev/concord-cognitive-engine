/**
 * EvoAsset frontend loader — resolves an asset reference to its current
 * best-quality version.
 *
 * Server-side, every asset is a row in `evo_assets` plus zero-or-more
 * promoted version rows in `evo_asset_versions`. The frontend doesn't need
 * to know any of that — it just calls `resolveAssetUrl(source, sourceId)`
 * and gets back the URL of whatever version is currently canonical.
 *
 * Caches resolutions in-memory for the session so a scene with 200 trees
 * doesn't make 200 round trips for the same asset.
 */

interface ResolvedAsset {
  url: string;
  qualityLevel: number;
  pass: string | null;
  cachedAt: number;
}

const cache = new Map<string, ResolvedAsset>();
const CACHE_TTL_MS = 5 * 60 * 1000; // re-check every 5 min — assets evolve

function cacheKey(source: string, sourceId: string): string {
  return `${source}:${sourceId}`;
}

export interface AssetReference {
  source: string;
  sourceId: string;
  /** Fallback URL if the resolution fails (network, no canonical yet). */
  fallbackUrl?: string;
}

/**
 * Resolve an asset reference to its current canonical URL.
 * Returns the fallback URL if resolution fails or the asset isn't registered.
 */
export async function resolveAssetUrl(ref: AssetReference): Promise<string | null> {
  const key = cacheKey(ref.source, ref.sourceId);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.url;
  }

  try {
    const res = await fetch(`/api/evo-asset/resolve?source=${encodeURIComponent(ref.source)}&sourceId=${encodeURIComponent(ref.sourceId)}`);
    if (!res.ok) return ref.fallbackUrl ?? null;
    const json = await res.json();
    if (!json?.ok || !json.url) return ref.fallbackUrl ?? null;

    const resolved: ResolvedAsset = {
      url: json.url,
      qualityLevel: json.qualityLevel ?? 0,
      pass: json.pass ?? null,
      cachedAt: Date.now(),
    };
    cache.set(key, resolved);
    return resolved.url;
  } catch {
    return ref.fallbackUrl ?? null;
  }
}

/**
 * Pre-resolve a batch of asset references. Call at scene-load to warm
 * the cache before meshes start requesting their textures.
 */
export async function preresolveAssets(refs: AssetReference[]): Promise<void> {
  await Promise.all(refs.map((r) => resolveAssetUrl(r)));
}

/**
 * Record that the player interacted with an asset. Drives the asset's
 * interaction_points counter, which feeds the evolution scheduler.
 *
 * Best-effort — failures don't surface to the caller. Frontend should
 * fire-and-forget on relevant gameplay events.
 */
export function recordAssetInteraction(
  source: string,
  sourceId: string,
  action: string,
  weight: number = 1.0,
): void {
  try {
    void fetch("/api/evo-asset/interaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, sourceId, action, weight }),
    });
  } catch { /* fire-and-forget */ }
}

/**
 * PBR material-upgrade spec produced by the evo-asset `material_upgrade`
 * refinement pass. All fields optional — the renderer applies only the ones
 * the underlying Three.js material class can actually express.
 */
export interface EvoMaterialUpgrade {
  shadingModel?: string;
  roughness?: number;
  metalness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  iridescence?: number;
  [k: string]: unknown;
}

const materialCache = new Map<string, EvoMaterialUpgrade | null>();

/**
 * Resolve a promoted material_upgrade spec for an asset, or null if none
 * exists / the request fails. Same session-cache shape as resolveAssetUrl.
 * Never fabricates — a miss returns null and the caller leaves the material
 * exactly as the loaded GLB shipped it.
 *
 * Consumed by BuildingRenderer3D. Named follow-ups (same call shape):
 * creature-renderer, resource-node-renderer, weapon-archetypes.
 */
export async function resolveMaterialUpgrade(
  source: string,
  sourceId: string,
): Promise<EvoMaterialUpgrade | null> {
  const key = cacheKey(source, sourceId);
  if (materialCache.has(key)) return materialCache.get(key) ?? null;
  try {
    const res = await fetch(
      `/api/evo-asset/material?source=${encodeURIComponent(source)}&sourceId=${encodeURIComponent(sourceId)}`,
    );
    if (!res.ok) { materialCache.set(key, null); return null; }
    const json = await res.json();
    if (!json?.ok || !json.material) { materialCache.set(key, null); return null; }
    const material = json.material as EvoMaterialUpgrade;
    materialCache.set(key, material);
    return material;
  } catch {
    materialCache.set(key, null);
    return null;
  }
}

/** Clear the in-memory resolution cache (e.g. on world change). */
export function clearAssetCache(): void {
  cache.clear();
  materialCache.clear();
}
