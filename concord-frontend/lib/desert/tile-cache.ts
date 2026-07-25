/**
 * Desert lens offline tile cache.
 *
 * Closes the WAVE4 desert-lens defect "No offline map caching for
 * no-signal fieldwork" (docs/WAVE4_INVENTORY.md; reasoning in
 * docs/lens-specs/desert-capability-map.md — "a client-side tile-cache
 * layer Concord doesn't have"). Desert expeditions plan routes
 * (ExpeditionPlanner), map resource nodes (ResourceNodeMap) and overlay
 * terrain samples (TerrainOverlay) — all three render the OSM basemap
 * through the shared `components/common/MapView`, which ~25 other lenses
 * also use unmodified. This module is desert-scoped and consumed only by
 * `components/desert/DesertOfflineMapView.tsx`, a NEW component the
 * desert lens's three map-bearing panels import instead of the shared
 * MapView — nothing here touches MapView or any other lens.
 *
 * Storage choice: browser Cache API, not IndexedDB.
 *   Map tiles are opaque binary blobs (PNG) fetched over HTTP by URL —
 *   exactly the shape the Cache API models (a real Request/Response pair).
 *   `cache.match(url)` returns the same Response a fetch would have,
 *   Content-Type included, so a cached tile round-trips with zero
 *   transcoding. IndexedDB would need a hand-rolled blob<->key schema for
 *   no benefit here. The existing PWA service worker (`public/sw.js`)
 *   already uses this exact Cache API pattern (cache-first assets,
 *   oldest-evicted-first via insertion order) for the app shell — this
 *   module follows the same idiom, scoped to desert map tiles instead of
 *   app-shell requests, and deliberately does NOT touch `public/sw.js`
 *   (that file is shared infrastructure for the whole app, not desert-
 *   scoped, and a lens-specific tile cache has no business changing what
 *   every other lens's asset caching does).
 *
 * Manifest: the Cache API stores Response bodies but not write timestamps
 * or a fast way to sum byte sizes, so a small JSON manifest is stored
 * *inside the same cache* under a synthetic same-cache key
 * (MANIFEST_KEY). It tracks `{ [tileUrl]: { bytes, ts } }` and is the
 * source of truth for both the honest stats readout and LRU eviction.
 * Manifest read-modify-write is serialized through `withManifestLock` so
 * concurrent tile fetches (precacheTiles runs several in parallel) can't
 * race and drop each other's updates.
 */

const CACHE_NAME = 'concord-desert-tiles-v1';
// @env-config-ok: not a real host — `concord.local` never resolves and this key is
// never fetched over the network. The Cache API requires a Request/URL-shaped key to
// store the manifest entry inside the same tile cache (see header comment above); this
// is a synthetic same-cache storage key, not a configurable endpoint.
const MANIFEST_KEY = 'https://concord.local/__desert_tile_manifest__';

/**
 * Storage cap: 50 MB. OSM raster tiles average roughly 12-25 KB each, so
 * this comfortably holds several thousand tiles — enough to pre-cache a
 * multi-zoom-level expedition area (the whole point of "cache this area
 * before you lose signal") without risking meaningful pressure on a
 * mobile device's disk during fieldwork prep. Override in tests via the
 * exported `evictToFit` (which takes explicit caps) rather than mutating
 * this constant.
 */
export const STORAGE_CAP_BYTES = 50 * 1024 * 1024;

/**
 * Hard cap on tile *count* independent of the byte cap — a defensive
 * backstop in case tiles come back much smaller than the ~12-25KB
 * average (e.g. a mocked/blank-ocean tile server), so a pathological
 * case can't accumulate tens of thousands of cache entries.
 */
export const MAX_TILES = 4000;

/** Guardrail on a single "cache this area" click (see DesertOfflineMapView). */
export const MAX_PRECACHE_TILES = 400;

export type TileSource = 'network' | 'cache' | 'unavailable';

export interface TileCacheStats {
  count: number;
  bytes: number;
}

interface ManifestEntry {
  bytes: number;
  ts: number;
}

type Manifest = Record<string, ManifestEntry>;

// ---------------------------------------------------------------------------
// Cache + manifest plumbing
// ---------------------------------------------------------------------------

async function getCache(): Promise<Cache> {
  return caches.open(CACHE_NAME);
}

async function readManifest(): Promise<Manifest> {
  const cache = await getCache();
  const res = await cache.match(MANIFEST_KEY);
  if (!res) return {};
  try {
    return (await res.json()) as Manifest;
  } catch {
    return {};
  }
}

async function writeManifest(manifest: Manifest): Promise<void> {
  const cache = await getCache();
  await cache.put(
    MANIFEST_KEY,
    new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } }),
  );
}

// Serializes manifest read-modify-write across concurrent tile stores so
// parallel precache workers don't clobber each other's writes.
let manifestLock: Promise<unknown> = Promise.resolve();
function withManifestLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = manifestLock.then(fn, fn);
  manifestLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ---------------------------------------------------------------------------
// Slippy-map tile math
// ---------------------------------------------------------------------------

/** OSM raster tile URL for a given z/x/y (standard slippy-map endpoint). */
export function tileUrl(z: number, x: number, y: number): string {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

/** Longitude/latitude (degrees) → slippy-map tile x/y at a given zoom. */
export function lonLatToTileXY(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  const clamp = (v: number) => Math.min(Math.max(v, 0), n - 1);
  return { x: clamp(x), y: clamp(y) };
}

export interface LngLatBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** All z/x/y tiles covering a lat/lng bounding box at a given zoom level. */
export function tilesForBounds(bounds: LngLatBounds, zoom: number): Array<{ z: number; x: number; y: number }> {
  const nw = lonLatToTileXY(bounds.west, bounds.north, zoom);
  const se = lonLatToTileXY(bounds.east, bounds.south, zoom);
  const out: Array<{ z: number; x: number; y: number }> = [];
  const minX = Math.min(nw.x, se.x);
  const maxX = Math.max(nw.x, se.x);
  const minY = Math.min(nw.y, se.y);
  const maxY = Math.max(nw.y, se.y);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      out.push({ z: zoom, x, y });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public cache API
// ---------------------------------------------------------------------------

/** True stats derived from the actual cached tiles — never a fabricated count. */
export async function getTileCacheStats(): Promise<TileCacheStats> {
  const manifest = await readManifest();
  const entries = Object.values(manifest);
  return {
    count: entries.length,
    bytes: entries.reduce((sum, e) => sum + e.bytes, 0),
  };
}

async function storeTile(url: string, blob: Blob): Promise<void> {
  const cache = await getCache();
  await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/png' } }));
  await withManifestLock(async () => {
    const manifest = await readManifest();
    manifest[url] = { bytes: blob.size, ts: Date.now() };
    await writeManifest(manifest);
  });
  await evictToFit(STORAGE_CAP_BYTES, MAX_TILES);
}

/**
 * LRU eviction (oldest write-timestamp first) down to the given byte and
 * count caps. Exported (not just called internally after every store) so
 * it can be exercised directly against small test caps without needing
 * to actually cache 50MB of fixtures.
 */
export async function evictToFit(capBytes: number, capCount: number): Promise<void> {
  await withManifestLock(async () => {
    const manifest = await readManifest();
    const entries = Object.entries(manifest).sort((a, b) => a[1].ts - b[1].ts);
    let totalBytes = entries.reduce((sum, [, v]) => sum + v.bytes, 0);
    if (totalBytes <= capBytes && entries.length <= capCount) return;

    const cache = await getCache();
    while (entries.length && (totalBytes > capBytes || entries.length > capCount)) {
      const [url, meta] = entries.shift()!;
      await cache.delete(url);
      delete manifest[url];
      totalBytes -= meta.bytes;
    }
    await writeManifest(manifest);
  });
}

/** Best-effort online signal — treated as online in non-browser contexts. */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

const NETWORK_TIMEOUT_MS = 8000;

/**
 * Resolve a tile: honest cache-first-when-offline, network-first-with-
 * cache-fallback when online. Never throws and never returns a broken
 * image — callers get `{ blob: null, source: 'unavailable' }` when
 * nothing usable exists, and are expected to render an explicit
 * placeholder for that case (see DesertOfflineMapView's protocol
 * handler) rather than a blank/broken tile.
 */
export async function getTile(
  url: string,
  opts?: { allowNetwork?: boolean },
): Promise<{ blob: Blob | null; source: TileSource }> {
  const allowNetwork = opts?.allowNetwork ?? !isOffline();
  const cache = await getCache();

  if (!allowNetwork) {
    const cached = await cache.match(url);
    if (cached) return { blob: await cached.blob(), source: 'cache' };
    return { blob: null, source: 'unavailable' };
  }

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS) : undefined;
    try {
      const res = await fetch(url, { mode: 'cors', signal: controller?.signal });
      if (!res.ok) throw new Error(`tile fetch failed: ${res.status}`);
      const blob = await res.blob();
      await storeTile(url, blob);
      return { blob, source: 'network' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    const cached = await cache.match(url);
    if (cached) return { blob: await cached.blob(), source: 'cache' };
    return { blob: null, source: 'unavailable' };
  }
}

export interface PrecacheResult {
  cached: number;
  failed: number;
}

/**
 * Fetches + caches a list of tile URLs with bounded concurrency, honestly
 * reporting real progress (never a fabricated percentage) via
 * `onProgress(done, total)`.
 */
export async function precacheTiles(
  urls: string[],
  onProgress?: (done: number, total: number) => void,
  concurrency = 6,
): Promise<PrecacheResult> {
  const queue = [...urls];
  const total = urls.length;
  let done = 0;
  let cached = 0;
  let failed = 0;

  async function worker() {
    for (;;) {
      const url = queue.shift();
      if (url === undefined) return;
      const { source } = await getTile(url, { allowNetwork: true });
      if (source === 'network' || source === 'cache') cached++;
      else failed++;
      done++;
      onProgress?.(done, total);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, urls.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { cached, failed };
}

/** Wipes the entire desert tile cache (used by tests / a future "clear cache" affordance). */
export async function clearTileCache(): Promise<void> {
  await caches.delete(CACHE_NAME);
}

export { CACHE_NAME };
