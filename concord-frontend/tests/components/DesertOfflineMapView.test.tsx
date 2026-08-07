import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// DesertOfflineMapView drives the real maplibre-gl WebGL renderer (jsdom
// can't run WebGL) — mocked the same way tests/components/MapView.test.tsx
// mocks it, plus `addProtocol` since this component's whole point is
// registering a custom tile protocol. The tile-cache engine itself
// (lib/desert/tile-cache.ts) is unit-tested directly in
// tests/lib/desert-tile-cache.test.ts against a real Cache API polyfill —
// here we only prove the component wires stats/progress/offline state to
// that module correctly.

const mapInstances: any[] = [];
const markerInstances: any[] = [];
const addProtocolMock = vi.fn();

function makeMockMap() {
  const listeners: Record<string, (() => void)[]> = {};
  const map = {
    addControl: vi.fn(),
    remove: vi.fn(),
    isStyleLoaded: vi.fn().mockReturnValue(true),
    once: vi.fn((evt: string, fn: () => void) => {
      (listeners[evt] ??= []).push(fn);
    }),
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
    getZoom: vi.fn().mockReturnValue(6),
    getBounds: vi.fn().mockReturnValue({
      getWest: () => 10,
      getSouth: () => 20,
      getEast: () => 12,
      getNorth: () => 22,
    }),
    _fireOnce: (evt: string) => listeners[evt]?.forEach((fn) => fn()),
  };
  mapInstances.push(map);
  return map;
}

function makeMockMarker() {
  const element = document.createElement('div');
  element.addEventListener = vi.fn(element.addEventListener.bind(element));
  const marker: any = {
    _element: element,
    setLngLat: vi.fn().mockReturnThis(),
    setPopup: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    getElement: vi.fn(() => element),
    remove: vi.fn(),
  };
  markerInstances.push(marker);
  return marker;
}

// maplibre-gl v6 ships no default export — the real module only has named
// exports (verified: `import * as m from 'maplibre-gl'` has no `.default`,
// `typeof m.Map === 'function'`). DesertOfflineMapView.tsx does
// `import * as maplibregl` and reads maplibregl.Map/.addProtocol directly,
// so the mock must match that shape.
vi.mock('maplibre-gl', () => {
  return {
    Map: vi.fn().mockImplementation(() => makeMockMap()),
    Marker: vi.fn().mockImplementation(() => makeMockMarker()),
    Popup: vi.fn().mockImplementation(() => ({ setHTML: vi.fn().mockReturnThis() })),
    NavigationControl: vi.fn().mockImplementation(() => ({})),
    // Deferred closure (not a direct reference) so this doesn't dereference
    // addProtocolMock until the mock is actually invoked — vi.mock factories
    // run before top-level const initializers in this file, so a direct
    // `addProtocol: addProtocolMock` reference hits a TDZ ReferenceError.
    addProtocol: (...args: unknown[]) => addProtocolMock(...args),
  };
});

const getTileCacheStats = vi.fn();
const precacheTiles = vi.fn();
const isOffline = vi.fn();
const getTile = vi.fn();

vi.mock('@/lib/desert/tile-cache', () => ({
  getTile: (...args: unknown[]) => getTile(...args),
  getTileCacheStats: (...args: unknown[]) => getTileCacheStats(...args),
  precacheTiles: (...args: unknown[]) => precacheTiles(...args),
  isOffline: (...args: unknown[]) => isOffline(...args),
  tileUrl: (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  tilesForBounds: (
    _bounds: { west: number; south: number; east: number; north: number },
    zoom: number,
  ) => [{ z: zoom, x: 1, y: 1 }],
  MAX_PRECACHE_TILES: 400,
  STORAGE_CAP_BYTES: 50 * 1024 * 1024,
}));

import DesertOfflineMapView from '@/components/desert/DesertOfflineMapView';

describe('DesertOfflineMapView', () => {
  beforeEach(() => {
    mapInstances.length = 0;
    markerInstances.length = 0;
    addProtocolMock.mockClear();
    getTileCacheStats.mockReset().mockResolvedValue({ count: 3, bytes: 3 * 1024 * 1024 });
    precacheTiles.mockReset().mockImplementation(async (urls: string[], onProgress?: (d: number, t: number) => void) => {
      urls.forEach((_u, i) => onProgress?.(i + 1, urls.length));
      return { cached: urls.length, failed: 0 };
    });
    isOffline.mockReset().mockReturnValue(false);
    getTile.mockReset().mockResolvedValue({ blob: new Blob(['x']), source: 'network' });
  });

  afterEach(() => cleanup());

  it('registers the desert-tile protocol on mount, and never re-registers it for a second mounted instance', async () => {
    render(<DesertOfflineMapView center={[10, 20]} zoom={4} />);
    expect(mapInstances).toHaveLength(1);
    expect(addProtocolMock).toHaveBeenCalledTimes(1);
    expect(addProtocolMock.mock.calls[0][0]).toBe('desert-tile');
    await waitFor(() => expect(getTileCacheStats).toHaveBeenCalled());

    render(<DesertOfflineMapView />);
    expect(mapInstances).toHaveLength(2);
    // Registration is idempotent module-level state — a second mounted
    // instance must not call addProtocol again.
    expect(addProtocolMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getTileCacheStats).toHaveBeenCalledTimes(2));
  });

  it('shows the real cache stats readout from getTileCacheStats, not a fabricated number', async () => {
    getTileCacheStats.mockResolvedValue({ count: 42, bytes: 12.5 * 1024 * 1024 });
    render(<DesertOfflineMapView />);
    await waitFor(() => {
      expect(screen.getByText(/42 tiles cached/)).toBeInTheDocument();
      expect(screen.getByText(/12\.5 MB/)).toBeInTheDocument();
    });
  });

  it('shows an offline banner when isOffline() is true', async () => {
    isOffline.mockReturnValue(true);
    render(<DesertOfflineMapView />);
    expect(screen.getByText(/Offline — showing cached tiles only/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cache this area/i })).toBeDisabled();
    await waitFor(() => expect(getTileCacheStats).toHaveBeenCalled());
  });

  it('does not show the offline banner when online', async () => {
    isOffline.mockReturnValue(false);
    render(<DesertOfflineMapView />);
    expect(screen.queryByText(/Offline — showing cached tiles only/)).not.toBeInTheDocument();
    await waitFor(() => expect(getTileCacheStats).toHaveBeenCalled());
  });

  it('clicking "Cache this area for offline use" calls precacheTiles with real tile URLs derived from the current map bounds, shows live progress, then refreshes stats', async () => {
    getTileCacheStats
      .mockResolvedValueOnce({ count: 0, bytes: 0 }) // initial mount
      .mockResolvedValueOnce({ count: 9, bytes: 900 }); // post-cache refresh

    render(<DesertOfflineMapView />);
    await waitFor(() => expect(getTileCacheStats).toHaveBeenCalledTimes(1));

    const button = screen.getByRole('button', { name: /cache this area/i });
    fireEvent.click(button);

    await waitFor(() => expect(precacheTiles).toHaveBeenCalledTimes(1));
    const [urls] = precacheTiles.mock.calls[0];
    expect(Array.isArray(urls)).toBe(true);
    expect(urls.length).toBeGreaterThan(0);
    urls.forEach((u: string) => expect(u).toMatch(/^https:\/\/tile\.openstreetmap\.org\//));

    await waitFor(() => expect(getTileCacheStats).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/9 tiles cached/)).toBeInTheDocument());
  });

  it('adds one marker per entry, matching the shared MapView contract', async () => {
    render(
      <DesertOfflineMapView markers={[{ lat: 1, lng: 2, label: 'A' }, { lat: 3, lng: 4, label: 'B', popup: 'details' }]} />,
    );
    expect(markerInstances).toHaveLength(2);
    await waitFor(() => expect(getTileCacheStats).toHaveBeenCalled());
  });

  it('removes the map instance on unmount', async () => {
    const { unmount } = render(<DesertOfflineMapView />);
    await waitFor(() => expect(getTileCacheStats).toHaveBeenCalled());
    unmount();
    expect(mapInstances[0].remove).toHaveBeenCalled();
  });
});
