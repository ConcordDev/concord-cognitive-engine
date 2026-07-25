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

// ── Interaction-recording noise gate ──────────────────────────────────
//
// Root cause (measured 2026-07-25): callers like BuildingRenderer3D fire
// `recordAssetInteraction('authored', building.id, 'render', 0.1)` for
// EVERY building in the scene on EVERY re-run of their render effect. That
// effect re-runs on data that streams in incrementally (buildings arriving
// in batches over the socket re-triggers the loop over the FULL array, not
// just the delta), so the same handful of building/NPC ids get re-posted
// repeatedly within a single lens load — 20-40 requests measured for one
// page. Every one of those 404s by construction, not by bad luck: the
// (source, sourceId) scheme the frontend uses for passive presence
// ('authored' + a building/npc DTU id) is never the scheme anything
// server-side registers an evo_assets row under — see
// server/lib/evo-asset/source-loaders.js (source:'authored' is reserved for
// the bundled CC0 seed-mesh manifest, keyed `seed:<file>`) and
// server/lib/gameplay-asset-bridge.js (auto-registration uses
// source:'concordia', keyed off skill/craft/drop/creature ids). So a
// building's presence-interaction can NEVER resolve until a human wires up
// a matching registration path — this is a standing mismatch, not a
// fresh-DB transient.
//
// Fix: once the server confirms 404 asset_not_found for a given
// (source, sourceId), remember it for a while and skip re-asking — the
// answer won't change moment to moment. Paired with an in-flight guard so a
// burst of same-tick calls for the same id doesn't stack N concurrent
// doomed requests before the first response lands. This does NOT touch the
// server's honest-404 behavior (that's correct) and does NOT suppress a
// genuinely new (source, sourceId) the caller hasn't asked about yet — only
// confirmed-doomed repeats.
const interactionNotFound = new Map<string, number>(); // key -> confirmed-404-at (ms)
const interactionInFlight = new Set<string>();
const INTERACTION_NOT_FOUND_TTL_MS = 10 * 60 * 1000; // 10 min — long enough to kill a session's re-render churn, short enough that a later real registration isn't hidden forever.

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
 *
 * Gated (see "Interaction-recording noise gate" above): skips the request
 * entirely when this exact (source, sourceId) was already confirmed
 * asset_not_found recently, or when an identical request is already in
 * flight. Everything else — first-ever asks, and any id that previously
 * resolved successfully — still fires exactly as before.
 */
export function recordAssetInteraction(
  source: string,
  sourceId: string,
  action: string,
  weight: number = 1.0,
): void {
  const key = cacheKey(source, sourceId);

  const notFoundAt = interactionNotFound.get(key);
  if (notFoundAt !== undefined && Date.now() - notFoundAt < INTERACTION_NOT_FOUND_TTL_MS) {
    return;
  }
  if (interactionInFlight.has(key)) {
    return;
  }

  interactionInFlight.add(key);
  try {
    void fetch("/api/evo-asset/interaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, sourceId, action, weight }),
    })
      .then((res) => {
        if (res.status === 404) {
          interactionNotFound.set(key, Date.now());
        }
      })
      .catch(() => { /* fire-and-forget */ })
      .finally(() => {
        interactionInFlight.delete(key);
      });
  } catch {
    interactionInFlight.delete(key);
    /* fire-and-forget */
  }
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
  interactionNotFound.clear();
  interactionInFlight.clear();
}
