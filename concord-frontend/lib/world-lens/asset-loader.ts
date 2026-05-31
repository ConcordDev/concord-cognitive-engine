/**
 * GLTF / GLB asset loader for Concordia.
 *
 * Phase F2 init 1: gives the world a real asset pipeline so that when GLB/GLTF
 * files are dropped into /public/models/ (or registered via evo-asset), the
 * renderer picks them up without changes to call sites.
 *
 * Three layers:
 *   1. resolveAssetReference() — turns an asset ref { kind, id } into a URL.
 *      Tries evo-asset first (resolveAssetUrl); falls back to /models/{kind}/{id}.glb;
 *      finally returns null and the caller renders the procedural fallback.
 *   2. loadGLTF() — wraps Three.js GLTFLoader with caching + Draco compression.
 *   3. instanceFromCache() — clones a cached scene cheaply so a single GLB
 *      file can render N copies without re-parsing the file.
 *
 * Caching is process-lifetime; assets are immutable per URL so we never
 * invalidate. Eviction happens via in-memory pressure (OOM safeguard).
 */

import { resolveAssetUrl } from "@/lib/evo-asset/loader";

export type AssetKind =
  | "humanoid"
  | "building"
  | "vehicle"
  | "prop"
  | "weapon"
  | "vegetation";

export interface AssetReference {
  kind: AssetKind;
  id: string;          // e.g., "merchant_male", "tavern_v1", "rapier"
  source?: string;     // evo-asset source override (defaults to "concordia")
  fallbackUrl?: string;
}

interface CachedScene {
  scene: unknown;       // THREE.Group; typed as unknown to avoid Three.js import here
  loadedAt: number;
  url: string;
}

const sceneCache = new Map<string, CachedScene>();
const inflight = new Map<string, Promise<unknown | null>>();

const HARD_CACHE_LIMIT = 64; // Max distinct GLBs in memory at once.

/** Resolve an asset reference to a URL. Returns null if no source available. */
export async function resolveAssetReference(ref: AssetReference): Promise<string | null> {
  // 1. Try evo-asset registry (server-side canonical version).
  try {
    const url = await resolveAssetUrl({
      source:    ref.source ?? "concordia",
      sourceId:  ref.id,
      fallbackUrl: undefined,
    });
    if (url) return url;
  } catch { /* network / 404 → try filesystem fallback */ }

  // 2. Filesystem convention: /public/models/{kind}/{id}.glb
  const fsPath = `/models/${ref.kind}/${ref.id}.glb`;
  // We can't reliably HEAD-check from here without a network round-trip; the
  // GLTFLoader will surface a 404 and the caller falls back to procedural.
  return ref.fallbackUrl ?? fsPath;
}

/**
 * Load a GLTF/GLB file. Cached by URL. Re-uses inflight promises so concurrent
 * callers requesting the same URL share a single fetch + parse pass.
 *
 * @returns The parsed Three.js scene root (Group), or null on failure.
 */
export async function loadGLTF(url: string, _THREE: typeof import("three")): Promise<unknown | null> {
  if (sceneCache.has(url)) return sceneCache.get(url)!.scene;
  if (inflight.has(url)) return inflight.get(url)!;

  const promise = (async () => {
    try {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      // Optional Draco support — falls back gracefully if the decoder isn't shipped.
      let dracoLoader: { setDecoderPath: (p: string) => void } | null = null;
      try {
        const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
        dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath("/draco/");
      } catch { /* draco optional */ }

      const loader = new GLTFLoader();
      if (dracoLoader && (loader as { setDRACOLoader?: (d: unknown) => void }).setDRACOLoader) {
        (loader as { setDRACOLoader: (d: unknown) => void }).setDRACOLoader(dracoLoader);
      }

      // Optional KTX2/Basis support for GLBs with GPU-compressed textures.
      // Uses the renderer ConcordiaScene registered; falls back gracefully.
      try {
        const { getKtx2LoaderForGltf } = await import("./texture-loader");
        const ktx2 = await getKtx2LoaderForGltf(_THREE);
        if (ktx2 && (loader as { setKTX2Loader?: (k: unknown) => void }).setKTX2Loader) {
          (loader as { setKTX2Loader: (k: unknown) => void }).setKTX2Loader(ktx2);
        }
      } catch { /* ktx2 optional */ }

      const gltf = await new Promise<{ scene: unknown }>((resolve, reject) => {
        (loader as { load: (u: string, onLoad: (g: { scene: unknown }) => void, onProgress?: () => void, onError?: (e: unknown) => void) => void })
          .load(url, resolve, undefined, reject);
      });

      // LRU-style eviction if we'd blow the cache.
      if (sceneCache.size >= HARD_CACHE_LIMIT) {
        const oldest = [...sceneCache.entries()].sort((a, b) => a[1].loadedAt - b[1].loadedAt)[0];
        if (oldest) sceneCache.delete(oldest[0]);
      }
      sceneCache.set(url, { scene: gltf.scene, loadedAt: Date.now(), url });
      return gltf.scene;
    } catch (err) {
      console.warn(`[asset-loader] failed to load ${url}:`, err);
      return null;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, promise);
  return promise;
}

/**
 * Cheap clone of a cached GLTF scene. Use this when you need N instances of
 * the same model — avoids re-parsing the file. The clone shares geometry and
 * materials; per-instance transforms must be set on the returned group.
 */
export async function instanceFromCache(url: string, THREE: typeof import("three")): Promise<unknown | null> {
  const cached = sceneCache.get(url);
  if (!cached) {
    // Not cached — load + cache, then clone the freshly cached version.
    const fresh = await loadGLTF(url, THREE);
    if (!fresh) return null;
    return cloneScene(fresh, THREE);
  }
  return cloneScene(cached.scene, THREE);
}

function cloneScene(root: unknown, _THREE: typeof import("three")): unknown {
  // Three.js SkinnedMesh clones are tricky — use SkeletonUtils when available.
  // For static meshes the default .clone(true) is fine.
  const r = root as { clone: (recursive: boolean) => unknown; type?: string };
  return r.clone(true);
}

/**
 * One-shot helper: resolve a reference and load the GLTF. Returns null if the
 * asset isn't available so callers can fall back to procedural rendering.
 */
export async function loadAsset(ref: AssetReference, THREE: typeof import("three")): Promise<unknown | null> {
  const url = await resolveAssetReference(ref);
  if (!url) return null;
  return loadGLTF(url, THREE);
}

/** Diagnostic: how many GLBs are currently parsed and resident. */
export function getAssetCacheStats(): { cached: number; inflight: number; urls: string[] } {
  return {
    cached:   sceneCache.size,
    inflight: inflight.size,
    urls:     [...sceneCache.keys()],
  };
}

/** Clear cache — useful in dev when assets are hot-reloaded. */
export function clearAssetCache(): void {
  sceneCache.clear();
}
