import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

// MapView drives the real maplibre-gl WebGL renderer, which jsdom can't run.
// Mock the library's public surface (Map/Marker/Popup/NavigationControl) so
// the component's own wiring — create-once, marker sync/recenter, click
// passthrough, teardown — is exercised without a real GL context.
const mapInstances: any[] = [];
const markerInstances: any[] = [];

function makeMockMap() {
  const listeners: Record<string, (() => void)[]> = {};
  let routeSource: { setData: ReturnType<typeof vi.fn> } | null = null;
  let routeLayerAdded = false;
  const map = {
    addControl: vi.fn(),
    remove: vi.fn(),
    isStyleLoaded: vi.fn().mockReturnValue(true),
    once: vi.fn((evt: string, fn: () => void) => {
      (listeners[evt] ??= []).push(fn);
    }),
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
    _fireOnce: (evt: string) => listeners[evt]?.forEach((fn) => fn()),
    // Route-line source/layer — real MapLibre GL API, minimally stubbed so
    // MapView's route effect (getSource/addSource/addLayer/getLayer/
    // removeLayer/removeSource) can run without a real GL context.
    getSource: vi.fn(() => routeSource),
    addSource: vi.fn((_id: string, spec: { data: unknown }) => {
      routeSource = { setData: vi.fn() };
      (map as any)._lastSourceData = spec.data;
    }),
    addLayer: vi.fn(() => { routeLayerAdded = true; }),
    getLayer: vi.fn(() => routeLayerAdded || undefined),
    removeLayer: vi.fn(() => { routeLayerAdded = false; }),
    removeSource: vi.fn(() => { routeSource = null; }),
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
// `typeof m.Map === 'function'`). MapView.tsx does `import * as maplibregl`
// and reads maplibregl.Map directly, so the mock must match that shape.
//
// MapView.tsx constructs these with `new` (`new maplibregl.Map(...)`,
// `new maplibregl.Marker()`, etc). An arrow-function mockImplementation has
// no [[Construct]] internal slot, so `new` on it throws "is not a
// constructor" — regular `function` expressions are required here (a
// constructor that explicitly returns an object substitutes that object for
// the implicit `this`, which is exactly the mock-swap this file wants).
vi.mock('maplibre-gl', () => {
  return {
    Map: vi.fn().mockImplementation(function () { return makeMockMap(); }),
    Marker: vi.fn().mockImplementation(function () { return makeMockMarker(); }),
    Popup: vi.fn().mockImplementation(function () { return { setHTML: vi.fn().mockReturnThis() }; }),
    NavigationControl: vi.fn().mockImplementation(function () { return {}; }),
  };
});

import MapView from '@/components/common/MapView';

describe('MapView', () => {
  beforeEach(() => {
    mapInstances.length = 0;
    markerInstances.length = 0;
  });

  it('creates a map once on mount with the seeded center/zoom and a nav control', () => {
    render(<MapView center={[10, 20]} zoom={4} />);
    expect(mapInstances).toHaveLength(1);
    expect(mapInstances[0].addControl).toHaveBeenCalled();
  });

  it('adds one marker per entry and wires the popup content', () => {
    render(
      <MapView
        markers={[{ lat: 1, lng: 2, label: 'A' }, { lat: 3, lng: 4, label: 'B', popup: 'details' }]}
      />,
    );
    expect(markerInstances).toHaveLength(2);
    markerInstances.forEach((m) => expect(m.addTo).toHaveBeenCalled());
  });

  it('recenters via easeTo for a single marker', () => {
    render(<MapView markers={[{ lat: 5, lng: 6, label: 'Solo' }]} />);
    expect(mapInstances[0].easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [6, 5], zoom: 10 }),
    );
    expect(mapInstances[0].fitBounds).not.toHaveBeenCalled();
  });

  it('fits bounds for multiple markers instead of easeTo', () => {
    render(
      <MapView
        markers={[{ lat: 1, lng: 1, label: 'A' }, { lat: 2, lng: 2, label: 'B' }]}
      />,
    );
    expect(mapInstances[0].fitBounds).toHaveBeenCalled();
    expect(mapInstances[0].easeTo).not.toHaveBeenCalled();
  });

  it('forwards marker clicks to onMarkerClick with the source marker', () => {
    const onMarkerClick = vi.fn();
    render(
      <MapView
        markers={[{ lat: 1, lng: 2, label: 'Clickable' }]}
        onMarkerClick={onMarkerClick}
      />,
    );
    const [marker] = markerInstances;
    const [, handler] = (marker._element.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
      ([evt]: [string]) => evt === 'click',
    )!;
    handler({ stopPropagation: vi.fn() });
    expect(onMarkerClick).toHaveBeenCalledWith(expect.objectContaining({ label: 'Clickable' }));
  });

  it('defers marker sync to the load event when the style is not yet loaded', () => {
    mapInstances.length = 0;
    const { rerender } = render(<MapView />);
    mapInstances[0].isStyleLoaded.mockReturnValue(false);
    rerender(<MapView markers={[{ lat: 1, lng: 1, label: 'Late' }]} />);
    expect(markerInstances).toHaveLength(0);
    mapInstances[0]._fireOnce('load');
    expect(markerInstances).toHaveLength(1);
  });

  it('removes the map instance on unmount', () => {
    const { unmount } = render(<MapView />);
    unmount();
    expect(mapInstances[0].remove).toHaveBeenCalled();
  });

  describe('route line', () => {
    it('does not create a source/layer for fewer than 2 route points', () => {
      render(<MapView route={[{ lat: 1, lng: 2 }]} />);
      expect(mapInstances[0].addSource).not.toHaveBeenCalled();
      expect(mapInstances[0].addLayer).not.toHaveBeenCalled();
    });

    it('adds a real GeoJSON LineString source + line layer for 2+ route points', () => {
      render(
        <MapView
          route={[{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { lat: 5, lng: 6 }]}
        />,
      );
      expect(mapInstances[0].addSource).toHaveBeenCalledTimes(1);
      const data = (mapInstances[0] as any)._lastSourceData;
      expect(data.geometry.type).toBe('LineString');
      // MapView stores lat/lng but MapLibre wants [lng, lat] — verify the swap happened.
      expect(data.geometry.coordinates).toEqual([[2, 1], [4, 3], [6, 5]]);
      expect(mapInstances[0].addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'line' }),
      );
    });

    it('updates the existing source via setData on a route change instead of re-adding it', () => {
      const { rerender } = render(
        <MapView route={[{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]} />,
      );
      expect(mapInstances[0].addSource).toHaveBeenCalledTimes(1);
      rerender(<MapView route={[{ lat: 1, lng: 1 }, { lat: 9, lng: 9 }]} />);
      expect(mapInstances[0].addSource).toHaveBeenCalledTimes(1);
      const source = mapInstances[0].getSource();
      expect(source.setData).toHaveBeenCalledWith(
        expect.objectContaining({
          geometry: expect.objectContaining({ coordinates: [[1, 1], [9, 9]] }),
        }),
      );
    });

    it('tears down the layer/source when the route shrinks back below 2 points', () => {
      const { rerender } = render(
        <MapView route={[{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]} />,
      );
      rerender(<MapView route={[]} />);
      expect(mapInstances[0].removeLayer).toHaveBeenCalled();
      expect(mapInstances[0].removeSource).toHaveBeenCalled();
    });

    it('folds route points into the bounds fit alongside markers', () => {
      render(
        <MapView
          markers={[{ lat: 1, lng: 1, label: 'Depot' }]}
          route={[{ lat: 1, lng: 1 }, { lat: 50, lng: 50 }]}
        />,
      );
      expect(mapInstances[0].fitBounds).toHaveBeenCalled();
    });
  });

  afterEach(() => cleanup());
});
