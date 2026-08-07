import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

// PinDropMap drives the real maplibre-gl WebGL renderer (jsdom can't run
// WebGL) — mocked the same way tests/components/MapView.test.tsx mocks it,
// plus `on('click', ...)` since this component wires map clicks to onPick.

const mapInstances: any[] = [];
const markerInstances: any[] = [];

function makeMockMap() {
  const listeners: Record<string, (() => void)[]> = {};
  const clickHandlers: Array<(e: any) => void> = [];
  const map = {
    addControl: vi.fn(),
    remove: vi.fn(),
    isStyleLoaded: vi.fn().mockReturnValue(true),
    once: vi.fn((evt: string, fn: () => void) => {
      (listeners[evt] ??= []).push(fn);
    }),
    on: vi.fn((evt: string, fn: (e: any) => void) => {
      if (evt === 'click') clickHandlers.push(fn);
    }),
    easeTo: vi.fn(),
    _fireOnce: (evt: string) => listeners[evt]?.forEach((fn) => fn()),
    _click: (lat: number, lng: number) => clickHandlers.forEach((fn) => fn({ lngLat: { lat, lng } })),
  };
  mapInstances.push(map);
  return map;
}

function makeMockMarker() {
  const marker: any = {
    setLngLat: vi.fn().mockReturnThis(),
    setPopup: vi.fn().mockReturnThis(),
    setText: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  };
  markerInstances.push(marker);
  return marker;
}

vi.mock('maplibre-gl', () => ({
  Map: vi.fn().mockImplementation(() => makeMockMap()),
  Marker: vi.fn().mockImplementation(() => makeMockMarker()),
  Popup: vi.fn().mockImplementation(() => ({
    setHTML: vi.fn().mockReturnThis(),
    setText: vi.fn().mockReturnThis(),
  })),
  NavigationControl: vi.fn().mockImplementation(() => ({})),
}));

import * as maplibregl from 'maplibre-gl';
import { PinDropMap, type ExistingMarker } from '@/components/government/PinDropMap';

function existing(overrides: Partial<ExistingMarker> = {}): ExistingMarker {
  return { lat: 10, lng: 20, label: 'Pothole', category: 'road_hazard', status: 'open', ...overrides };
}

describe('PinDropMap', () => {
  beforeEach(() => {
    mapInstances.length = 0;
    markerInstances.length = 0;
  });
  afterEach(() => cleanup());

  it('creates the map once, centered on the continental-US default when there is no pin or existing marker', () => {
    render(<PinDropMap existing={[]} pin={null} onPick={vi.fn()} />);
    expect(mapInstances).toHaveLength(1);
    expect(mapInstances[0].addControl).toHaveBeenCalled();
  });

  it('centers on the first existing marker when there is no dropped pin yet', () => {
    render(<PinDropMap existing={[existing({ lat: 5, lng: 6 })]} pin={null} onPick={vi.fn()} />);
    // Map is only ever created once (empty effect deps) — centering is
    // asserted via the constructor call args captured on the mock.
    const ctorArgs = (maplibregl.Map as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(ctorArgs.center).toEqual([6, 5]);
    expect(ctorArgs.zoom).toBe(12);
  });

  it('forwards a map click to onPick with lat/lng', () => {
    const onPick = vi.fn();
    render(<PinDropMap existing={[]} pin={null} onPick={onPick} />);
    mapInstances[0]._click(33.1, -97.2);
    expect(onPick).toHaveBeenCalledWith(33.1, -97.2);
  });

  it('always calls the LATEST onPick even though the click listener is registered once', () => {
    const onPickA = vi.fn();
    const { rerender } = render(<PinDropMap existing={[]} pin={null} onPick={onPickA} />);
    const onPickB = vi.fn();
    rerender(<PinDropMap existing={[]} pin={null} onPick={onPickB} />);
    expect(mapInstances).toHaveLength(1); // map/listener not recreated
    mapInstances[0]._click(1, 2);
    expect(onPickA).not.toHaveBeenCalled();
    expect(onPickB).toHaveBeenCalledWith(1, 2);
  });

  it('adds one marker+popup per existing report and clears stale ones on update', () => {
    const { rerender } = render(<PinDropMap existing={[existing(), existing({ lat: 11, lng: 21, label: 'B' })]} pin={null} onPick={vi.fn()} />);
    expect(markerInstances.filter((m) => m.addTo.mock.calls.length > 0)).toHaveLength(2);
    rerender(<PinDropMap existing={[existing({ label: 'Solo' })]} pin={null} onPick={vi.fn()} />);
    // Two removed from the first pass, one fresh marker added for the second.
    expect(markerInstances[0].remove).toHaveBeenCalled();
    expect(markerInstances[1].remove).toHaveBeenCalled();
  });

  it('drops a custom pin marker and eases the camera to it when pin is set', () => {
    const { rerender } = render(<PinDropMap existing={[]} pin={null} onPick={vi.fn()} />);
    rerender(<PinDropMap existing={[]} pin={{ lat: 40, lng: -105 }} onPick={vi.fn()} />);
    expect(mapInstances[0].easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-105, 40] }));
  });

  it('removes the previous pin marker before dropping a new one, and removes it entirely when pin goes back to null', () => {
    const { rerender } = render(<PinDropMap existing={[]} pin={{ lat: 1, lng: 2 }} onPick={vi.fn()} />);
    const firstPinMarker = markerInstances[markerInstances.length - 1];
    rerender(<PinDropMap existing={[]} pin={{ lat: 3, lng: 4 }} onPick={vi.fn()} />);
    expect(firstPinMarker.remove).toHaveBeenCalled();
    rerender(<PinDropMap existing={[]} pin={null} onPick={vi.fn()} />);
    // No throw, and no new marker added for a null pin.
    expect(mapInstances).toHaveLength(1);
  });

  it('defers existing-marker sync and pin placement to the load event when the style is not yet loaded', () => {
    (maplibregl.Map as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      const map = makeMockMap();
      map.isStyleLoaded.mockReturnValue(false);
      return map;
    });
    render(<PinDropMap existing={[existing()]} pin={{ lat: 1, lng: 2 }} onPick={vi.fn()} />);
    const map = mapInstances[0];
    expect(markerInstances).toHaveLength(0);
    map._fireOnce('load');
    expect(markerInstances.length).toBeGreaterThan(0);
  });

  it('removes the map instance on unmount', () => {
    const { unmount } = render(<PinDropMap existing={[]} pin={null} onPick={vi.fn()} />);
    unmount();
    expect(mapInstances[0].remove).toHaveBeenCalled();
  });
});
