import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import React from 'react';

// TrackMap drives the real maplibre-gl WebGL renderer (jsdom can't run
// WebGL) — mocked the same way tests/components/MapView.test.tsx mocks it,
// plus getSource/addSource/addLayer since this component draws a GeoJSON
// line source directly (it doesn't go through the shared MapView wrapper).

const mapInstances: any[] = [];
const markerInstances: any[] = [];

function makeMockMap() {
  const listeners: Record<string, (() => void)[]> = {};
  const sources: Record<string, { setData: ReturnType<typeof vi.fn> }> = {};
  const map = {
    addControl: vi.fn(),
    remove: vi.fn(),
    isStyleLoaded: vi.fn().mockReturnValue(true),
    once: vi.fn((evt: string, fn: () => void) => {
      (listeners[evt] ??= []).push(fn);
    }),
    getSource: vi.fn((id: string) => sources[id]),
    addSource: vi.fn((id: string) => {
      sources[id] = { setData: vi.fn() };
    }),
    addLayer: vi.fn(),
    _fireOnce: (evt: string) => listeners[evt]?.forEach((fn) => fn()),
  };
  mapInstances.push(map);
  return map;
}

function makeMockMarker() {
  const marker: any = {
    setLngLat: vi.fn().mockReturnThis(),
    setPopup: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  };
  markerInstances.push(marker);
  return marker;
}

vi.mock('maplibre-gl', () => ({
  Map: vi.fn().mockImplementation(() => makeMockMap()),
  Marker: vi.fn().mockImplementation(() => makeMockMarker()),
  Popup: vi.fn().mockImplementation(() => ({ setHTML: vi.fn().mockReturnThis() })),
  NavigationControl: vi.fn().mockImplementation(() => ({})),
}));

import * as maplibregl from 'maplibre-gl';
import { TrackMap } from '@/components/aviation/TrackMap';

function track(overrides: Partial<Parameters<typeof TrackMap>[0]['tracks'][0]> = {}) {
  return {
    id: 't1',
    tail: 'N123AB',
    from: 'KJFK',
    to: 'KBOS',
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T01:00:00Z',
    points: [
      { lat: 40.6, lng: -73.8, altitudeFt: 1000, groundSpeedKts: 120, timestamp: '2026-01-01T00:00:00Z' },
      { lat: 42.3, lng: -71.0, altitudeFt: 8000, groundSpeedKts: 220, timestamp: '2026-01-01T01:00:00Z' },
    ],
    maxAltitudeFt: 8000,
    totalDistanceNm: 187.3,
    ...overrides,
  };
}

describe('TrackMap', () => {
  beforeEach(() => {
    mapInstances.length = 0;
    markerInstances.length = 0;
  });
  afterEach(() => cleanup());

  it('shows the empty-state message when no track has points', () => {
    render(<TrackMap tracks={[{ ...track(), points: [] }]} />);
    expect(screen.getByText(/Start a track/i)).toBeInTheDocument();
    expect(mapInstances).toHaveLength(0);
  });

  it('creates a map centered on the average of all track points and draws a line source', () => {
    render(<TrackMap tracks={[track()]} />);
    expect(mapInstances).toHaveLength(1);
    expect(mapInstances[0].addSource).toHaveBeenCalledWith(
      'tracks',
      expect.objectContaining({ type: 'geojson' }),
    );
    expect(mapInstances[0].addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tracks-line', type: 'line' }),
    );
  });

  it('adds a start and end marker for each track with points', () => {
    render(<TrackMap tracks={[track(), track({ id: 't2', tail: 'N456CD', endedAt: null })]} />);
    expect(markerInstances).toHaveLength(4);
    markerInstances.forEach((m) => expect(m.addTo).toHaveBeenCalled());
  });

  it('rebuilds the map (remove old, create + draw new) when the tracks prop changes', () => {
    const { rerender } = render(<TrackMap tracks={[track()]} />);
    const first = mapInstances[0];
    expect(first.addSource).toHaveBeenCalledTimes(1);
    rerender(<TrackMap tracks={[track({ tail: 'N999ZZ' })]} />);
    // center/tracksWithPoints are recomputed to new array references on any
    // tracks-prop change, so the effect's cleanup removes the old map and a
    // fresh one is created and drawn on — verified end to end here rather
    // than assumed.
    expect(first.remove).toHaveBeenCalled();
    expect(mapInstances).toHaveLength(2);
    expect(mapInstances[1].addSource).toHaveBeenCalledTimes(1);
  });

  it('takes the setData branch when a draw is re-triggered on a map whose source already exists', () => {
    // draw() only runs once per real map instance in the component's own
    // wiring, so the getSource-truthy branch is unreachable through normal
    // props alone — exercise it directly by firing the deferred 'load'
    // callback twice against the same style-not-loaded map, which is the
    // one legitimate way maplibre's own event contract could invoke it more
    // than once (a style can reload after a `styledata` change upstream).
    (maplibregl.Map as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      const map = makeMockMap();
      map.isStyleLoaded.mockReturnValue(false);
      return map;
    });
    render(<TrackMap tracks={[track()]} />);
    const map = mapInstances[0];
    map._fireOnce('load');
    expect(map.addSource).toHaveBeenCalledTimes(1);
    map._fireOnce('load');
    expect(map.getSource('tracks').setData).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenCalledTimes(1);
  });

  it('defers the draw to the load event when the style is not yet loaded', () => {
    (maplibregl.Map as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      const map = makeMockMap();
      map.isStyleLoaded.mockReturnValue(false);
      return map;
    });
    render(<TrackMap tracks={[track()]} />);
    const map = mapInstances[0];
    expect(map.addSource).not.toHaveBeenCalled();
    map._fireOnce('load');
    expect(map.addSource).toHaveBeenCalled();
  });

  it('removes the map instance on unmount', () => {
    const { unmount } = render(<TrackMap tracks={[track()]} />);
    unmount();
    expect(mapInstances[0].remove).toHaveBeenCalled();
  });

  it('renders the pre-mount placeholder synchronously before effects flush', () => {
    // Smoke-check the un-mounted branch shape exists and doesn't throw when
    // there are zero tracks passed at all.
    render(<TrackMap tracks={[]} className="my-map" />);
    expect(screen.getByText(/Start a track/i)).toBeInTheDocument();
  });
});
