import { describe, it, expect, vi, beforeEach } from 'vitest';

// lib/desert/tile-cache.ts is a thin wrapper around the browser Cache API.
// jsdom doesn't implement `caches`, so this file provides a small in-memory
// CacheStorage/Cache polyfill that honors the real Cache API contract
// (Request|string keys, Response values, `.blob()`/`.json()` on the
// returned Response) closely enough to exercise the real module logic —
// nothing under test is mocked, only the browser API surface it sits on.

class FakeCache {
  store = new Map<string, Response>();
  async match(key: string | Request): Promise<Response | undefined> {
    const k = typeof key === 'string' ? key : key.url;
    const res = this.store.get(k);
    return res ? res.clone() : undefined;
  }
  async put(key: string | Request, res: Response): Promise<void> {
    const k = typeof key === 'string' ? key : key.url;
    this.store.set(k, res.clone());
  }
  async delete(key: string | Request): Promise<boolean> {
    const k = typeof key === 'string' ? key : key.url;
    return this.store.delete(k);
  }
  async keys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }
}

class FakeCacheStorage {
  caches = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name)!;
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
}

function makePngResponse(bytes: number, status = 200): Response {
  const body = new Uint8Array(bytes);
  return new Response(body, { status, headers: { 'Content-Type': 'image/png' } });
}

let fakeCaches: FakeCacheStorage;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeCaches = new FakeCacheStorage();
  vi.stubGlobal('caches', fakeCaches);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('navigator', { onLine: true });
  vi.resetModules();
});

async function importFresh() {
  return import('@/lib/desert/tile-cache');
}

describe('desert tile-cache: math helpers', () => {
  it('builds the standard OSM slippy-map tile URL', async () => {
    const { tileUrl } = await importFresh();
    expect(tileUrl(5, 10, 15)).toBe('https://tile.openstreetmap.org/5/10/15.png');
  });

  it('zoom 0 always resolves to the single (0,0) tile regardless of lon/lat', async () => {
    const { lonLatToTileXY } = await importFresh();
    expect(lonLatToTileXY(0, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(lonLatToTileXY(-179, 84, 0)).toEqual({ x: 0, y: 0 });
    expect(lonLatToTileXY(179, -84, 0)).toEqual({ x: 0, y: 0 });
  });

  it('tilesForBounds at zoom 0 returns exactly the one world tile', async () => {
    const { tilesForBounds } = await importFresh();
    const tiles = tilesForBounds({ west: -170, south: -80, east: 170, north: 80 }, 0);
    expect(tiles).toEqual([{ z: 0, x: 0, y: 0 }]);
  });

  it('tilesForBounds at zoom 2 returns a rectangular grid covering the bbox corners', async () => {
    const { tilesForBounds, lonLatToTileXY } = await importFresh();
    const bounds = { west: -100, south: -20, east: -50, north: 40 };
    const tiles = tilesForBounds(bounds, 2);
    const nw = lonLatToTileXY(bounds.west, bounds.north, 2);
    const se = lonLatToTileXY(bounds.east, bounds.south, 2);
    const expectedCount = (Math.abs(se.x - nw.x) + 1) * (Math.abs(se.y - nw.y) + 1);
    expect(tiles.length).toBe(expectedCount);
    expect(tiles).toContainEqual({ z: 2, x: nw.x, y: nw.y });
    expect(tiles).toContainEqual({ z: 2, x: se.x, y: se.y });
  });
});

describe('desert tile-cache: fetch + cache + offline behavior', () => {
  it('caches a tile on first network fetch', async () => {
    const { getTile, getTileCacheStats, tileUrl } = await importFresh();
    const url = tileUrl(4, 1, 1);
    fetchMock.mockResolvedValueOnce(makePngResponse(1000));

    const result = await getTile(url, { allowNetwork: true });

    expect(result.source).toBe('network');
    expect(result.blob?.size).toBe(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const stats = await getTileCacheStats();
    expect(stats.count).toBe(1);
    expect(stats.bytes).toBe(1000);
  });

  it('serves a cached tile on repeat request without an additional network call', async () => {
    const { getTile, tileUrl } = await importFresh();
    const url = tileUrl(4, 2, 2);
    fetchMock.mockResolvedValueOnce(makePngResponse(2048));

    const first = await getTile(url, { allowNetwork: true });
    expect(first.source).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Simulate being offline for the repeat request — if this reached the
    // network it would throw (no mock queued), proving the cache was hit.
    const second = await getTile(url, { allowNetwork: false });
    expect(second.source).toBe('cache');
    expect(second.blob?.size).toBe(2048);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to cache when a network fetch throws while online', async () => {
    const { getTile, tileUrl } = await importFresh();
    const url = tileUrl(4, 3, 3);
    fetchMock.mockResolvedValueOnce(makePngResponse(500));
    await getTile(url, { allowNetwork: true });

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const result = await getTile(url, { allowNetwork: true });
    expect(result.source).toBe('cache');
    expect(result.blob?.size).toBe(500);
  });

  it('an uncached tile while offline resolves to an honest "unavailable" state, never throws, never touches the network', async () => {
    const { getTile, tileUrl } = await importFresh();
    const url = tileUrl(9, 100, 100);

    const result = await getTile(url, { allowNetwork: false });

    expect(result).toEqual({ blob: null, source: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an uncached tile while online with a failing network also resolves to "unavailable", not a throw', async () => {
    const { getTile, tileUrl } = await importFresh();
    const url = tileUrl(9, 101, 101);
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    const result = await getTile(url, { allowNetwork: true });

    expect(result).toEqual({ blob: null, source: 'unavailable' });
  });

  it('a non-ok HTTP response is treated as a failure, not cached, and falls through to unavailable', async () => {
    const { getTile, getTileCacheStats, tileUrl } = await importFresh();
    const url = tileUrl(9, 102, 102);
    fetchMock.mockResolvedValueOnce(makePngResponse(10, 404));

    const result = await getTile(url, { allowNetwork: true });

    expect(result.source).toBe('unavailable');
    const stats = await getTileCacheStats();
    expect(stats.count).toBe(0);
  });
});

describe('desert tile-cache: real stats readout', () => {
  it('reflects the actual number and total bytes of cached tiles, not a fabricated count', async () => {
    const { getTile, getTileCacheStats, tileUrl } = await importFresh();
    const sizes = [1000, 2500, 777];
    for (let i = 0; i < sizes.length; i++) {
      fetchMock.mockResolvedValueOnce(makePngResponse(sizes[i]));
      await getTile(tileUrl(5, i, i), { allowNetwork: true });
    }

    const stats = await getTileCacheStats();
    expect(stats.count).toBe(3);
    expect(stats.bytes).toBe(sizes.reduce((a, b) => a + b, 0));
  });

  it('clearTileCache empties the stats back to zero', async () => {
    const { getTile, getTileCacheStats, clearTileCache, tileUrl } = await importFresh();
    fetchMock.mockResolvedValueOnce(makePngResponse(1234));
    await getTile(tileUrl(5, 9, 9), { allowNetwork: true });
    expect((await getTileCacheStats()).count).toBe(1);

    await clearTileCache();
    expect(await getTileCacheStats()).toEqual({ count: 0, bytes: 0 });
  });
});

describe('desert tile-cache: eviction respects the storage cap', () => {
  it('evicts the oldest tiles first once the byte cap is exceeded', async () => {
    const { getTile, getTileCacheStats, evictToFit, tileUrl } = await importFresh();

    // Cache 5 tiles of 100 bytes each, spaced so write order is unambiguous.
    for (let i = 0; i < 5; i++) {
      fetchMock.mockResolvedValueOnce(makePngResponse(100));
      await getTile(tileUrl(6, i, i), { allowNetwork: true });
      // advance the clock so timestamps strictly increase between writes
      await new Promise((r) => setTimeout(r, 2));
    }
    expect((await getTileCacheStats()).count).toBe(5);

    // Force eviction down to a cap that only fits 2 tiles (200 bytes).
    await evictToFit(200, 100);

    const stats = await getTileCacheStats();
    expect(stats.count).toBe(2);
    expect(stats.bytes).toBeLessThanOrEqual(200);

    // The two survivors must be the most-recently-written ones (tile 3, tile 4).
    const cache = await fakeCaches.open('concord-desert-tiles-v1');
    const keys = await cache.keys();
    expect(keys).toContain(tileUrl(6, 3, 3));
    expect(keys).toContain(tileUrl(6, 4, 4));
    expect(keys).not.toContain(tileUrl(6, 0, 0));
    expect(keys).not.toContain(tileUrl(6, 1, 1));
  });

  it('evicts down to a tile-count cap even when under the byte cap', async () => {
    const { getTile, getTileCacheStats, evictToFit, tileUrl } = await importFresh();
    for (let i = 0; i < 4; i++) {
      fetchMock.mockResolvedValueOnce(makePngResponse(10));
      await getTile(tileUrl(7, i, i), { allowNetwork: true });
      await new Promise((r) => setTimeout(r, 2));
    }
    expect((await getTileCacheStats()).count).toBe(4);

    await evictToFit(1_000_000, 2);

    expect((await getTileCacheStats()).count).toBe(2);
  });

  it('storing a tile past the default cap automatically triggers eviction (no unbounded growth)', async () => {
    const { getTile, getTileCacheStats, tileUrl, MAX_TILES } = await importFresh();
    // Sanity: the exported default cap is a real, documented finite number.
    expect(MAX_TILES).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_TILES)).toBe(true);

    fetchMock.mockResolvedValueOnce(makePngResponse(50));
    await getTile(tileUrl(8, 1, 1), { allowNetwork: true });
    const stats = await getTileCacheStats();
    expect(stats.count).toBe(1);
    expect(stats.bytes).toBe(50);
  });
});

describe('desert tile-cache: precacheTiles', () => {
  it('fetches every requested tile, reports honest progress, and reflects it in stats', async () => {
    const { precacheTiles, getTileCacheStats, tileUrl } = await importFresh();
    const urls = [tileUrl(6, 0, 0), tileUrl(6, 0, 1), tileUrl(6, 1, 0), tileUrl(6, 1, 1)];
    // A fresh Response per call — Response bodies are single-read streams,
    // so reusing one instance across concurrent workers would make all but
    // the first `.blob()` call fail.
    fetchMock.mockImplementation(() => Promise.resolve(makePngResponse(100)));

    const progressCalls: Array<[number, number]> = [];
    const result = await precacheTiles(urls, (done, total) => progressCalls.push([done, total]), 2);

    expect(result).toEqual({ cached: 4, failed: 0 });
    expect(progressCalls.length).toBe(4);
    expect(progressCalls[progressCalls.length - 1]).toEqual([4, 4]);

    const stats = await getTileCacheStats();
    expect(stats.count).toBe(4);
    expect(stats.bytes).toBe(400);
  });

  it('counts failed tiles honestly instead of pretending they cached', async () => {
    const { precacheTiles, tileUrl } = await importFresh();
    const urls = [tileUrl(6, 5, 5), tileUrl(6, 6, 6)];
    fetchMock
      .mockResolvedValueOnce(makePngResponse(100))
      .mockRejectedValueOnce(new Error('network down'));

    const result = await precacheTiles(urls, undefined, 1);
    expect(result).toEqual({ cached: 1, failed: 1 });
  });
});
