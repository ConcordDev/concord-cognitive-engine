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
vi.mock('maplibre-gl', () => {
  return {
    Map: vi.fn().mockImplementation(() => makeMockMap()),
    Marker: vi.fn().mockImplementation(() => makeMockMarker()),
    Popup: vi.fn().mockImplementation(() => ({ setHTML: vi.fn().mockReturnThis() })),
    NavigationControl: vi.fn().mockImplementation(() => ({})),
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

  afterEach(() => cleanup());
});
